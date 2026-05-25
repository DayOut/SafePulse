using HeartPulse.DTOs;
using HeartPulse.Models;
using HeartPulse.Options;
using HeartPulse.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace HeartPulse.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(
    IAuthService authService,
    IUserService userService,
    ITelegramLinkService telegramLinkService,
    IEmailVerificationService emailVerificationService,
    IOptions<AuthOptions> authOptions) : ControllerBase
{
    private const string RefreshCookieName = "safepulse_refresh";
    private readonly AuthOptions _auth = authOptions.Value;

    [AllowAnonymous]
    [HttpPost("register")]
    public async Task<ActionResult<RegistrationPendingResponse>> Register([FromBody] RegisterRequest request, CancellationToken ct)
    {
        try
        {
            var user = await authService.RegisterWithPasswordAsync(request.Email, request.UserName, request.Password, ct);
            await emailVerificationService.SendVerificationEmailAsync(user, ct);
            return Accepted(new RegistrationPendingResponse { Email = user.Email! });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(ex.Message);
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(ex.Message);
        }
    }

    [AllowAnonymous]
    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login([FromBody] LoginRequest request, CancellationToken ct)
    {
        try
        {
            var session = await authService.LoginWithPasswordAsync(request.Email, request.Password, ct);
            SetRefreshCookie(session.RefreshToken);
            return Ok(ToAuthResponse(session.User, session.AccessToken, session.AccessTokenExpiresAt));
        }
        catch (UnauthorizedAccessException ex)
        {
            return Unauthorized(ex.Message);
        }
        catch (InvalidOperationException ex) when (ex.Message == "Email verification required")
        {
            return StatusCode(403, ex.Message);
        }
    }

    [AllowAnonymous]
    [HttpGet("verify-email")]
    public async Task<IActionResult> VerifyEmail([FromQuery] string token, CancellationToken ct)
    {
        var user = await emailVerificationService.VerifyTokenAsync(token, ct);
        if (user is null)
            return Redirect("/?emailVerifyError=1");

        var session = await authService.IssueSessionForVerifiedUserAsync(user, ct);
        SetRefreshCookie(session.RefreshToken);
        return Redirect("/?emailVerified=1");
    }

    [AllowAnonymous]
    [HttpPost("email-verification/resend")]
    public async Task<IActionResult> ResendVerification([FromBody] ResendVerificationRequest request, CancellationToken ct)
    {
        await emailVerificationService.ResendVerificationEmailAsync(request.Email, ct);
        return Accepted();
    }

    [AllowAnonymous]
    [HttpPost("telegram")]
    public async Task<ActionResult<AuthResponse>> Telegram([FromBody] TelegramLoginRequest request, CancellationToken ct)
    {
        try
        {
            var session = await authService.LoginWithTelegramAsync(request, ct);
            SetRefreshCookie(session.RefreshToken);
            return Ok(ToAuthResponse(session.User, session.AccessToken, session.AccessTokenExpiresAt));
        }
        catch (UnauthorizedAccessException ex)
        {
            return Unauthorized(ex.Message);
        }
    }

    [AllowAnonymous]
    [HttpPost("dev")]
    public async Task<ActionResult<AuthResponse>> Dev([FromBody] DevLoginRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.UserId) || string.IsNullOrWhiteSpace(request.UserName))
            return BadRequest("UserId and UserName are required");

        try
        {
            var session = await authService.DevLoginAsync(request.UserId, request.UserName, ct);
            SetRefreshCookie(session.RefreshToken);
            return Ok(ToAuthResponse(session.User, session.AccessToken, session.AccessTokenExpiresAt));
        }
        catch (UnauthorizedAccessException ex)
        {
            return Unauthorized(ex.Message);
        }
    }

    [AllowAnonymous]
    [HttpPost("refresh")]
    public async Task<ActionResult<AuthResponse>> Refresh(CancellationToken ct)
    {
        var refreshToken = Request.Cookies[RefreshCookieName];
        if (string.IsNullOrWhiteSpace(refreshToken))
            return Unauthorized();

        var session = await authService.RefreshAsync(refreshToken, ct);
        if (session is null)
        {
            ClearRefreshCookie();
            return Unauthorized();
        }

        SetRefreshCookie(session.Value.RefreshToken);
        return Ok(ToAuthResponse(session.Value.User, session.Value.AccessToken, session.Value.AccessTokenExpiresAt));
    }

    [AllowAnonymous]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout(CancellationToken ct)
    {
        var refreshToken = Request.Cookies[RefreshCookieName];
        if (!string.IsNullOrWhiteSpace(refreshToken))
            await authService.RevokeRefreshTokenAsync(refreshToken, ct);

        ClearRefreshCookie();
        return NoContent();
    }

    [Authorize]
    [HttpGet("me")]
    public async Task<ActionResult<UserDto>> Me(CancellationToken ct)
    {
        var userId = User.GetUserId();
        if (userId is null)
            return Unauthorized();

        var user = await userService.TouchLastSeenOnlineAsync(userId, ct);
        return user is null ? NotFound() : Ok(ToDto(user));
    }

    [Authorize]
    [HttpPost("telegram-link-codes")]
    public async Task<ActionResult<TelegramLinkCodeDto>> CreateTelegramLinkCode(CancellationToken ct)
    {
        var userId = User.GetUserId();
        if (userId is null)
            return Unauthorized();

        return Ok(await telegramLinkService.CreateCodeAsync(userId, ct));
    }

    [Authorize]
    [HttpGet("telegram-link-codes/{codeId}")]
    public async Task<ActionResult<TelegramLinkStatusDto>> GetTelegramLinkStatus(string codeId, CancellationToken ct)
    {
        var userId = User.GetUserId();
        if (userId is null)
            return Unauthorized();

        var status = await telegramLinkService.GetStatusAsync(codeId, userId, ct);
        return status is null ? NotFound() : Ok(status);
    }

    [Authorize]
    [HttpDelete("telegram-link")]
    public async Task<ActionResult<UserDto>> DisconnectTelegram(CancellationToken ct)
    {
        var userId = User.GetUserId();
        if (userId is null)
            return Unauthorized();

        var user = await telegramLinkService.DisconnectAsync(userId, ct);
        return user is null ? NotFound() : Ok(ToDto(user));
    }

    [Authorize]
    [HttpPatch("me")]
    public async Task<ActionResult<UserDto>> UpdateProfile([FromBody] UpdateProfileRequest request, CancellationToken ct)
    {
        var userId = User.GetUserId();
        if (userId is null)
            return Unauthorized();

        if (string.IsNullOrWhiteSpace(request.UserName))
            return BadRequest("UserName is required");

        var user = await userService.UpdateAsync(userId, request.UserName.Trim(), null, ct);
        return user is null ? NotFound() : Ok(ToDto(user));
    }

    [Authorize]
    [HttpPost("set-password")]
    public async Task<ActionResult<RegistrationPendingResponse>> SetPassword([FromBody] SetPasswordRequest request, CancellationToken ct)
    {
        var userId = User.GetUserId();
        if (userId is null)
            return Unauthorized();

        try
        {
            var user = await authService.SetPasswordAsync(userId, request.Email, request.Password, ct);
            await emailVerificationService.SendVerificationEmailAsync(user, ct);
            return Accepted(new RegistrationPendingResponse { Email = user.Email! });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(ex.Message);
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(ex.Message);
        }
    }

    [Authorize]
    [HttpPost("change-password")]
    public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest request, CancellationToken ct)
    {
        var userId = User.GetUserId();
        if (userId is null)
            return Unauthorized();

        try
        {
            await authService.ChangePasswordAsync(userId, request.CurrentPassword, request.NewPassword, ct);
            return NoContent();
        }
        catch (ArgumentException ex)
        {
            return BadRequest(ex.Message);
        }
        catch (UnauthorizedAccessException ex)
        {
            return Unauthorized(ex.Message);
        }
    }

    [Authorize]
    [HttpPatch("me/language")]
    public async Task<ActionResult<UserDto>> UpdateLanguage([FromBody] UpdateLanguageRequest request, CancellationToken ct)
    {
        var userId = User.GetUserId();
        if (userId is null)
            return Unauthorized();

        var user = await userService.SetLanguageAsync(userId, request.Language, ct);
        return user is null ? NotFound() : Ok(ToDto(user));
    }

    private void SetRefreshCookie(string refreshToken)
    {
        Response.Cookies.Append(RefreshCookieName, refreshToken, new CookieOptions
        {
            HttpOnly = true,
            Secure = Request.IsHttps,
            SameSite = SameSiteMode.Lax,
            Expires = DateTimeOffset.UtcNow.AddDays(_auth.RefreshTokenDays)
        });
    }

    private void ClearRefreshCookie()
    {
        Response.Cookies.Delete(RefreshCookieName, new CookieOptions
        {
            HttpOnly = true,
            Secure = Request.IsHttps,
            SameSite = SameSiteMode.Lax
        });
    }

    private static AuthResponse ToAuthResponse(AppUser user, string accessToken, DateTime expiresAt) => new()
    {
        AccessToken = accessToken,
        AccessTokenExpiresAt = expiresAt,
        User = ToDto(user)
    };

    private static UserDto ToDto(AppUser user) => new()
    {
        Id = user.Id,
        UserName = user.UserName,
        Email = user.Email,
        ChatId = user.ChatId,
        TelegramUserId = user.TelegramUserId,
        Language = string.IsNullOrWhiteSpace(user.Language) ? "en" : user.Language,
        Status = user.Status.ToString(),
        LastActiveAt = user.LastActiveAt,
        LastSeenOnlineAt = user.LastSeenOnlineAt ?? user.LastActiveAt,
        CreatedAt = user.CreatedAt ?? user.LastActiveAt,
        UpdatedAt = user.UpdatedAt ?? user.LastActiveAt
    };
}

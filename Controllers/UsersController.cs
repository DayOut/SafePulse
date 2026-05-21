using HeartPulse.DTOs;
using HeartPulse.Models;
using HeartPulse.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace HeartPulse.Controllers;

[ApiController]
[Route("api/users")]
public class UsersController(IUserService userService) : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<UserDto>> Create([FromBody] CreateUserRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.UserName))
            return BadRequest("UserName is required");

        if (!TryParseStatus(request.Status, out var status))
            return BadRequest("Status is invalid");

        try
        {
            var user = await userService.CreateAsync(request.Id, request.UserName, request.ChatId, status ?? UserStatus.Unknown, ct);
            return CreatedAtAction(nameof(GetById), new { userId = user.Id }, ToDto(user));
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(ex.Message);
        }
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<UserDto>>> GetAll(CancellationToken ct)
    {
        var users = await userService.GetAllAsync(ct);
        return Ok(users.Select(ToDto));
    }

    [HttpGet("{userId}")]
    public async Task<ActionResult<UserDto>> GetById(string userId, CancellationToken ct)
    {
        var user = await userService.GetByIdAsync(userId, ct);
        return user is null ? NotFound() : Ok(ToDto(user));
    }

    [HttpPatch("{userId}")]
    public async Task<ActionResult<UserDto>> Update(string userId, [FromBody] UpdateUserRequest request, CancellationToken ct)
    {
        if (!TryParseStatus(request.Status, out var status))
            return BadRequest("Status is invalid");

        var user = await userService.UpdateAsync(userId, request.UserName, request.ChatId, status, ct);
        return user is null ? NotFound() : Ok(ToDto(user));
    }

    [HttpDelete("{userId}")]
    public async Task<IActionResult> Delete(string userId, CancellationToken ct)
    {
        var deleted = await userService.SoftDeleteAsync(userId, ct);
        return deleted ? NoContent() : NotFound();
    }

    private static bool TryParseStatus(string? rawStatus, out UserStatus? status)
    {
        status = null;
        if (string.IsNullOrWhiteSpace(rawStatus))
            return true;

        if (!Enum.TryParse<UserStatus>(rawStatus, ignoreCase: true, out var parsed))
            return false;

        status = parsed;
        return true;
    }

    private static UserDto ToDto(AppUser user) => new()
    {
        Id = user.Id,
        UserName = user.UserName,
        ChatId = user.ChatId,
        Status = user.Status.ToString(),
        LastActiveAt = user.LastActiveAt,
        CreatedAt = user.CreatedAt ?? user.LastActiveAt,
        UpdatedAt = user.UpdatedAt ?? user.LastActiveAt
    };
}

using System.Globalization;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using HeartPulse.Data;
using HeartPulse.DTOs;
using HeartPulse.Models;
using HeartPulse.Options;
using HeartPulse.Services.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using MongoDB.Driver;

namespace HeartPulse.Services;

public class AuthService(
    SafePulseContext db,
    IMongoDatabase mongoDatabase,
    IOptions<AuthOptions> authOptions,
    IOptions<TelegramOptions> telegramOptions) : IAuthService
{
    private readonly AuthOptions _auth = authOptions.Value;
    private readonly TelegramOptions _telegram = telegramOptions.Value;
    private readonly IMongoCollection<RefreshSession> _refreshSessions = mongoDatabase.GetCollection<RefreshSession>("refreshSessions");

    public async Task<(AppUser User, string AccessToken, DateTime AccessTokenExpiresAt, string RefreshToken)> RegisterWithPasswordAsync(
        string email,
        string userName,
        string password,
        CancellationToken ct)
    {
        var normalizedEmail = NormalizeEmail(email);
        var trimmedUserName = userName.Trim();
        ValidatePasswordAuthInput(normalizedEmail, trimmedUserName, password);

        var exists = await db.Users.AnyAsync(u => u.NormalizedEmail == normalizedEmail && u.IsDeleted != true, ct);
        if (exists)
            throw new InvalidOperationException("Email is already registered");

        var now = DateTime.UtcNow;
        var user = new AppUser
        {
            Id = Guid.NewGuid().ToString(),
            UserName = trimmedUserName,
            Email = email.Trim(),
            NormalizedEmail = normalizedEmail,
            PasswordHash = HashPassword(password),
            Language = "en",
            Status = UserStatus.Unknown,
            LastActiveAt = now,
            LastSeenOnlineAt = now,
            CreatedAt = now,
            UpdatedAt = now,
            IsDeleted = false,
            Roles = []
        };

        ApplyEmailAdminRole(user);

        await db.Users.AddAsync(user, ct);
        await db.SaveChangesAsync(ct);
        return await IssueSessionAsync(user, ct);
    }

    public async Task<(AppUser User, string AccessToken, DateTime AccessTokenExpiresAt, string RefreshToken)> LoginWithPasswordAsync(
        string email,
        string password,
        CancellationToken ct)
    {
        var normalizedEmail = NormalizeEmail(email);
        var user = await db.Users.FirstOrDefaultAsync(u => u.NormalizedEmail == normalizedEmail && u.IsDeleted != true, ct);
        if (user is null || string.IsNullOrWhiteSpace(user.PasswordHash) || !VerifyPassword(password, user.PasswordHash))
            throw new UnauthorizedAccessException("Invalid email or password");

        user.LastSeenOnlineAt = DateTime.UtcNow;
        user.UpdatedAt = DateTime.UtcNow;
        user.Roles ??= [];
        ApplyEmailAdminRole(user);

        await db.SaveChangesAsync(ct);
        return await IssueSessionAsync(user, ct);
    }

    public async Task<(AppUser User, string AccessToken, DateTime AccessTokenExpiresAt, string RefreshToken)> LoginWithTelegramAsync(
        TelegramLoginRequest request,
        CancellationToken ct)
    {
        if (!IsValidTelegramPayload(request))
            throw new UnauthorizedAccessException("Invalid Telegram login payload");

        var userId = request.Id.ToString(CultureInfo.InvariantCulture);
        var userName = BuildTelegramUserName(request);
        var user = await UpsertLoginUserAsync(userId, userName, request.Id, ct);

        return await IssueSessionAsync(user, ct);
    }

    public async Task<(AppUser User, string AccessToken, DateTime AccessTokenExpiresAt, string RefreshToken)?> RefreshAsync(
        string refreshToken,
        CancellationToken ct)
    {
        var tokenHash = HashToken(refreshToken);
        var existing = await _refreshSessions
            .Find(s => s.TokenHash == tokenHash)
            .FirstOrDefaultAsync(ct);

        if (existing is null || existing.RevokedAt is not null || existing.ExpiresAt <= DateTime.UtcNow)
            return null;

        var user = await db.Users.FindAsync(new object?[] { existing.UserId }, ct);
        if (user is null || user.IsDeleted == true)
            return null;

        user.LastSeenOnlineAt = DateTime.UtcNow;
        user.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        var (session, rawRefreshToken) = CreateRefreshSession(user.Id);
        await _refreshSessions.UpdateOneAsync(
            s => s.Id == existing.Id,
            Builders<RefreshSession>.Update
                .Set(s => s.RevokedAt, DateTime.UtcNow)
                .Set(s => s.ReplacedBySessionId, session.Id),
            cancellationToken: ct);
        await _refreshSessions.InsertOneAsync(session, cancellationToken: ct);

        var (accessToken, expiresAt) = CreateAccessToken(user);
        return (user, accessToken, expiresAt, rawRefreshToken);
    }

    public async Task RevokeRefreshTokenAsync(string refreshToken, CancellationToken ct)
    {
        var tokenHash = HashToken(refreshToken);
        await _refreshSessions.UpdateOneAsync(
            s => s.TokenHash == tokenHash && s.RevokedAt == null,
            Builders<RefreshSession>.Update.Set(s => s.RevokedAt, DateTime.UtcNow),
            cancellationToken: ct);
    }

    public async Task<(AppUser User, string AccessToken, DateTime AccessTokenExpiresAt, string RefreshToken)> DevLoginAsync(
        string userId,
        string userName,
        CancellationToken ct)
    {
        if (!_auth.EnableDevLogin)
            throw new UnauthorizedAccessException("Development login is disabled");

        var user = await UpsertLoginUserAsync(userId.Trim(), userName.Trim(), null, ct);
        return await IssueSessionAsync(user, ct);
    }

    private async Task<AppUser> UpsertLoginUserAsync(string userId, string userName, long? chatId, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var user = await db.Users.FindAsync(new object?[] { userId }, ct);
        if (user is null)
        {
            user = new AppUser
            {
                Id = userId,
                CreatedAt = now,
                Status = UserStatus.Unknown,
                Language = chatId.HasValue ? "uk" : "en"
            };
            await db.Users.AddAsync(user, ct);
        }

        user.UserName = string.IsNullOrWhiteSpace(userName) ? userId : userName;
        if (string.IsNullOrWhiteSpace(user.Language))
            user.Language = chatId.HasValue ? "uk" : "en";
        user.ChatId = chatId ?? user.ChatId;
        if (user.LastActiveAt == default)
            user.LastActiveAt = now;
        user.LastSeenOnlineAt = now;
        user.UpdatedAt = now;
        user.IsDeleted = false;
        user.Roles ??= [];

        if (_auth.BootstrapAdminTelegramIds.Contains(user.Id, StringComparer.Ordinal) &&
            !user.Roles.Contains("Admin", StringComparer.Ordinal))
        {
            user.Roles.Add("Admin");
        }

        await db.SaveChangesAsync(ct);
        return user;
    }

    private async Task<(AppUser User, string AccessToken, DateTime AccessTokenExpiresAt, string RefreshToken)> IssueSessionAsync(AppUser user, CancellationToken ct)
    {
        var (session, rawRefreshToken) = CreateRefreshSession(user.Id);
        await _refreshSessions.InsertOneAsync(session, cancellationToken: ct);

        var (accessToken, expiresAt) = CreateAccessToken(user);
        return (user, accessToken, expiresAt, rawRefreshToken);
    }

    private (string Token, DateTime ExpiresAt) CreateAccessToken(AppUser user)
    {
        if (string.IsNullOrWhiteSpace(_auth.SigningKey))
            throw new InvalidOperationException("Auth:SigningKey is not configured");

        var expiresAt = DateTime.UtcNow.AddMinutes(_auth.AccessTokenMinutes);
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id),
            new(ClaimTypes.NameIdentifier, user.Id),
            new(ClaimTypes.Name, user.UserName),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new(JwtRegisteredClaimNames.Iat, EpochTime.GetIntDate(DateTime.UtcNow).ToString(CultureInfo.InvariantCulture), ClaimValueTypes.Integer64)
        };

        foreach (var role in (user.Roles ?? []).Distinct(StringComparer.Ordinal))
            claims.Add(new Claim(ClaimTypes.Role, role));

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_auth.SigningKey));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: _auth.Issuer,
            audience: _auth.Audience,
            claims: claims,
            expires: expiresAt,
            signingCredentials: credentials);

        return (new JwtSecurityTokenHandler().WriteToken(token), expiresAt);
    }

    private (RefreshSession Session, string RawToken) CreateRefreshSession(string userId)
    {
        var rawToken = Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));
        var session = new RefreshSession
        {
            Id = Guid.NewGuid().ToString(),
            UserId = userId,
            TokenHash = HashToken(rawToken),
            CreatedAt = DateTime.UtcNow,
            ExpiresAt = DateTime.UtcNow.AddDays(_auth.RefreshTokenDays)
        };

        return (session, rawToken);
    }

    private bool IsValidTelegramPayload(TelegramLoginRequest request)
    {
        if (string.IsNullOrWhiteSpace(_telegram.BotToken) || string.IsNullOrWhiteSpace(request.Hash))
            return false;

        var authDate = DateTimeOffset.FromUnixTimeSeconds(request.AuthDate);
        if (authDate < DateTimeOffset.UtcNow.AddMinutes(-_auth.TelegramAuthMaxAgeMinutes))
            return false;

        var fields = new SortedDictionary<string, string>(StringComparer.Ordinal)
        {
            ["auth_date"] = request.AuthDate.ToString(CultureInfo.InvariantCulture),
            ["id"] = request.Id.ToString(CultureInfo.InvariantCulture)
        };

        AddIfPresent(fields, "first_name", request.FirstName);
        AddIfPresent(fields, "last_name", request.LastName);
        AddIfPresent(fields, "photo_url", request.PhotoUrl);
        AddIfPresent(fields, "username", request.Username);

        var dataCheckString = string.Join('\n', fields.Select(kvp => $"{kvp.Key}={kvp.Value}"));
        var secretKey = SHA256.HashData(Encoding.UTF8.GetBytes(_telegram.BotToken));
        using var hmac = new HMACSHA256(secretKey);
        var computedHash = Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(dataCheckString))).ToLowerInvariant();

        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(computedHash),
            Encoding.UTF8.GetBytes(request.Hash.ToLowerInvariant()));
    }

    private static void AddIfPresent(IDictionary<string, string> fields, string key, string? value)
    {
        if (!string.IsNullOrWhiteSpace(value))
            fields[key] = value;
    }

    private static string BuildTelegramUserName(TelegramLoginRequest request)
    {
        var fullName = string.Join(' ', new[] { request.FirstName, request.LastName }.Where(x => !string.IsNullOrWhiteSpace(x)));
        if (!string.IsNullOrWhiteSpace(fullName))
            return fullName;

        return string.IsNullOrWhiteSpace(request.Username)
            ? request.Id.ToString(CultureInfo.InvariantCulture)
            : request.Username;
    }

    private static string HashToken(string token)
    {
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();
    }

    private void ApplyEmailAdminRole(AppUser user)
    {
        if (string.IsNullOrWhiteSpace(user.NormalizedEmail))
            return;

        user.Roles ??= [];
        var adminEmails = _auth.BootstrapAdminEmails
            .Select(NormalizeEmail)
            .Where(x => !string.IsNullOrWhiteSpace(x));

        if (adminEmails.Contains(user.NormalizedEmail, StringComparer.Ordinal) &&
            !user.Roles.Contains("Admin", StringComparer.Ordinal))
        {
            user.Roles.Add("Admin");
        }
    }

    private static void ValidatePasswordAuthInput(string normalizedEmail, string userName, string password)
    {
        if (string.IsNullOrWhiteSpace(normalizedEmail) || !normalizedEmail.Contains('@'))
            throw new ArgumentException("Valid email is required");

        if (string.IsNullOrWhiteSpace(userName))
            throw new ArgumentException("UserName is required");

        if (string.IsNullOrWhiteSpace(password) || password.Length < 8)
            throw new ArgumentException("Password must be at least 8 characters");
    }

    private static string NormalizeEmail(string email)
    {
        return email.Trim().ToUpperInvariant();
    }

    private static string HashPassword(string password)
    {
        const int iterations = 100_000;
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(
            password,
            salt,
            iterations,
            HashAlgorithmName.SHA256,
            32);

        return $"PBKDF2-SHA256${iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    private static bool VerifyPassword(string password, string storedHash)
    {
        try
        {
            var parts = storedHash.Split('$');
            if (parts.Length != 4 || parts[0] != "PBKDF2-SHA256")
                return false;

            if (!int.TryParse(parts[1], CultureInfo.InvariantCulture, out var iterations))
                return false;

            var salt = Convert.FromBase64String(parts[2]);
            var expectedHash = Convert.FromBase64String(parts[3]);
            var actualHash = Rfc2898DeriveBytes.Pbkdf2(
                password,
                salt,
                iterations,
                HashAlgorithmName.SHA256,
                expectedHash.Length);

            return CryptographicOperations.FixedTimeEquals(actualHash, expectedHash);
        }
        catch (FormatException)
        {
            return false;
        }
    }
}

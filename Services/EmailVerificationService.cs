using System.Net;
using System.Security.Cryptography;
using System.Text;
using HeartPulse.Data;
using HeartPulse.Models;
using HeartPulse.Options;
using HeartPulse.Services.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using MongoDB.Driver;

namespace HeartPulse.Services;

public class EmailVerificationService(
    SafePulseContext db,
    IMongoDatabase mongoDatabase,
    IEmailSender emailSender,
    IOptions<EmailVerificationOptions> verificationOptions,
    IOptions<AppOptions> appOptions) : IEmailVerificationService
{
    private readonly EmailVerificationOptions _opts = verificationOptions.Value;
    private readonly AppOptions _app = appOptions.Value;
    private readonly IMongoCollection<EmailVerificationToken> _tokens =
        mongoDatabase.GetCollection<EmailVerificationToken>("emailVerificationTokens");

    public async Task SendVerificationEmailAsync(AppUser user, CancellationToken ct)
    {
        if (user.EmailVerificationLastSentAt.HasValue)
        {
            var elapsed = (DateTime.UtcNow - user.EmailVerificationLastSentAt.Value).TotalSeconds;
            if (elapsed < _opts.ResendCooldownSeconds)
                return;
        }

        var rawToken = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        var now = DateTime.UtcNow;

        var token = new EmailVerificationToken
        {
            Id = Guid.NewGuid().ToString(),
            UserId = user.Id,
            NormalizedEmail = user.NormalizedEmail!,
            TokenHash = HashToken(rawToken),
            CreatedAt = now,
            ExpiresAt = now.AddDays(_opts.TokenDays)
        };

        await _tokens.InsertOneAsync(token, cancellationToken: ct);

        user.EmailVerificationLastSentAt = now;
        user.UpdatedAt = now;
        await db.SaveChangesAsync(ct);

        var baseUrl = _app.PublicBaseUrl?.TrimEnd('/') ?? string.Empty;
        var verifyUrl = $"{baseUrl}/api/auth/verify-email?token={Uri.EscapeDataString(rawToken)}";
        var html = BuildVerificationEmail(user.UserName, verifyUrl, _opts.TokenDays);
        await emailSender.SendAsync(user.Email!, "Verify your SafePulse email", html, ct);
    }

    public async Task<AppUser?> VerifyTokenAsync(string rawToken, CancellationToken ct)
    {
        var tokenHash = HashToken(rawToken);
        var token = await _tokens.Find(t => t.TokenHash == tokenHash).FirstOrDefaultAsync(ct);

        if (token is null || token.ConsumedAt.HasValue || token.ExpiresAt <= DateTime.UtcNow)
            return null;

        await _tokens.UpdateOneAsync(
            t => t.Id == token.Id,
            Builders<EmailVerificationToken>.Update.Set(t => t.ConsumedAt, DateTime.UtcNow),
            cancellationToken: ct);

        var user = await db.Users.FindAsync(new object?[] { token.UserId }, ct);
        if (user is null || user.IsDeleted == true)
            return null;

        user.EmailVerifiedAt = DateTime.UtcNow;
        user.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        return user;
    }

    public async Task ResendVerificationEmailAsync(string email, CancellationToken ct)
    {
        var normalizedEmail = email.Trim().ToUpperInvariant();
        var user = await db.Users.FirstOrDefaultAsync(
            u => u.NormalizedEmail == normalizedEmail && u.IsDeleted != true, ct);

        if (user is null || user.EmailVerifiedAt.HasValue)
            return;

        await SendVerificationEmailAsync(user, ct);
    }

    private static string HashToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();

    private static string BuildVerificationEmail(string userName, string verifyUrl, int tokenDays) => $"""
        <html>
        <body style="font-family:ui-monospace,monospace;background:#0a0a0a;color:#fafafa;padding:40px;margin:0">
          <div style="max-width:480px;margin:0 auto">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:32px">
              <div style="width:10px;height:10px;border-radius:50%;background:#4ade80"></div>
              <span style="font-size:18px;font-weight:700;letter-spacing:0.05em">SafePulse</span>
            </div>
            <p style="color:#a3a3a3;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 8px">Hello, {WebUtility.HtmlEncode(userName)}</p>
            <h2 style="font-size:20px;font-weight:700;margin:0 0 16px;color:#fafafa">Verify your email address</h2>
            <p style="color:#a3a3a3;font-size:14px;line-height:1.6;margin:0 0 28px">
              Click the button below to activate your SafePulse account. This link expires in {tokenDays} days.
            </p>
            <a href="{verifyUrl}"
               style="display:inline-block;background:#4ade80;color:#0a0a0a;padding:12px 28px;
                      text-decoration:none;font-weight:700;font-size:13px;letter-spacing:0.1em;
                      text-transform:uppercase">
              VERIFY EMAIL
            </a>
            <p style="color:#525252;font-size:11px;margin-top:32px;line-height:1.6">
              If you did not register for SafePulse, you can safely ignore this email.
            </p>
          </div>
        </body>
        </html>
        """;
}

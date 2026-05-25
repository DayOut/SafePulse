using HeartPulse.Models;

namespace HeartPulse.Services.Interfaces;

public interface IEmailVerificationService
{
    Task SendVerificationEmailAsync(AppUser user, CancellationToken ct);
    Task<AppUser?> VerifyTokenAsync(string rawToken, CancellationToken ct);
    Task ResendVerificationEmailAsync(string email, CancellationToken ct);
}

using HeartPulse.Models;

namespace HeartPulse.Services.Interfaces;

public interface IUserService
{
    Task<AppUser> GetOrCreateAsync(string userId, string userName, long chatId, CancellationToken ct);
    Task<AppUser?> GetAsync(string userId, string userName, long chatId, CancellationToken ct);
    Task UpdateStatusAsync(AppUser user, UserStatus status, CancellationToken ct);
}

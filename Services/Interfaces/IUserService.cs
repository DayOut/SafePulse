using HeartPulse.Models;

namespace HeartPulse.Services.Interfaces;

public interface IUserService
{
    Task<AppUser> GetOrCreateAsync(string userId, string userName, long chatId, CancellationToken ct);
    Task<AppUser?> GetAsync(string userId, string userName, long chatId, CancellationToken ct);
    Task<IReadOnlyList<AppUser>> GetAllAsync(CancellationToken ct);
    Task<AppUser?> GetByIdAsync(string userId, CancellationToken ct);
    Task<AppUser> CreateAsync(string? id, string userName, long? chatId, UserStatus status, CancellationToken ct);
    Task<AppUser?> UpdateAsync(string userId, string? userName, long? chatId, UserStatus? status, CancellationToken ct);
    Task<AppUser?> UpdateStatusAsync(string userId, UserStatus status, CancellationToken ct);
    Task<AppUser?> TouchLastSeenOnlineAsync(string userId, CancellationToken ct);
    Task<AppUser?> SetTelegramNotificationsAsync(string userId, bool enabled, CancellationToken ct);
    Task<AppUser?> SetLanguageAsync(string userId, string language, CancellationToken ct);
    Task<bool> SoftDeleteAsync(string userId, CancellationToken ct);
    Task UpdateStatusAsync(AppUser user, UserStatus status, CancellationToken ct);
}

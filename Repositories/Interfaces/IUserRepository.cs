using HeartPulse.Models;

namespace HeartPulse.Repositories.Interfaces;

public interface IUserRepository
{
    Task<AppUser?> GetByIdAsync(string userId, CancellationToken ct);
    Task<AppUser?> UpdateStatusAsync(string userId, UserStatus status, CancellationToken ct);
}

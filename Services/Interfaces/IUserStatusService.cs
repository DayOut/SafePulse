using HeartPulse.Events;
using HeartPulse.Models;

namespace HeartPulse.Services.Interfaces;

public interface IUserStatusService
{
    Task<AppUser?> ChangeStatusAsync(string userId, UserStatus status, UserStatusChangeSource source, CancellationToken ct);
}

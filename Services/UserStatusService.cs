using HeartPulse.Events;
using HeartPulse.Models;
using HeartPulse.Repositories.Interfaces;
using HeartPulse.Services.Interfaces;

namespace HeartPulse.Services;

public class UserStatusService(
    IUserRepository users,
    IUserEventQueue events) : IUserStatusService
{
    public async Task<AppUser?> ChangeStatusAsync(string userId, UserStatus status, UserStatusChangeSource source, CancellationToken ct)
    {
        var user = await users.UpdateStatusAsync(userId, status, ct);
        if (user is null)
            return null;

        await events.EnqueueAsync(new UserStatusChangedEvent(user, source, DateTime.UtcNow), ct);
        return user;
    }
}

using HeartPulse.DTOs;
using HeartPulse.Models;

namespace HeartPulse.Notifiers.Interfaces;

public interface IGroupNotificationBuilder
{
    Task<IReadOnlyList<GroupStatusNotification>> BuildStatusNotificationsAsync(
        AppUser changedUser,
        CancellationToken ct);
}
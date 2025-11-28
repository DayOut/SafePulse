using HeartPulse.Models;

namespace HeartPulse.Notifiers.Interfaces;

public interface IGroupNotifier
{
    Task NotifyStatusChangedAsync(AppUser changedUser, CancellationToken ct);
    Task SendMessageAsync(string message, AppUser user, CancellationToken ct);
}
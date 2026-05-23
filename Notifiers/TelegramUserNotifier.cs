using HeartPulse.Events;
using HeartPulse.Notifiers.Interfaces;

namespace HeartPulse.Notifiers;

public class TelegramUserNotifier(IGroupNotifier groupNotifier) : IUserStatusChangedEventHandler
{
    public Task HandleAsync(UserStatusChangedEvent userEvent, CancellationToken ct)
    {
        if (userEvent.Source == UserStatusChangeSource.FakeSimulator)
            return Task.CompletedTask;

        return groupNotifier.NotifyStatusChangedAsync(userEvent.User, ct);
    }
}

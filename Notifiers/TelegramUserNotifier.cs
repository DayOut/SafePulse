using HeartPulse.Events;
using HeartPulse.Notifiers.Interfaces;

namespace HeartPulse.Notifiers;

public class TelegramUserNotifier(IGroupNotifier groupNotifier) : IUserStatusChangedEventHandler
{
    public Task HandleAsync(UserStatusChangedEvent userEvent, CancellationToken ct)
    {
        // StatusRequestReset floods N events when a group is reset; the status-request
        // notification message already covers this, so skip individual Telegram updates.
        if (userEvent.Source is UserStatusChangeSource.FakeSimulator
                              or UserStatusChangeSource.StatusRequestReset)
            return Task.CompletedTask;

        return groupNotifier.NotifyStatusChangedAsync(userEvent.User, ct);
    }
}

namespace HeartPulse.Events;

public interface IUserEventQueue
{
    ValueTask EnqueueAsync(UserStatusChangedEvent userEvent, CancellationToken ct);
    ValueTask<UserStatusChangedEvent> DequeueAsync(CancellationToken ct);
}

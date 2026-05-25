namespace HeartPulse.Events;

public interface IUserStatusChangedEventHandler
{
    Task HandleAsync(UserStatusChangedEvent userEvent, CancellationToken ct);
}

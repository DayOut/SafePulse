using System.Threading.Channels;

namespace HeartPulse.Events;

public class UserEventQueue : IUserEventQueue
{
    private readonly Channel<UserStatusChangedEvent> _queue = Channel.CreateUnbounded<UserStatusChangedEvent>(
        new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false
        });

    public ValueTask EnqueueAsync(UserStatusChangedEvent userEvent, CancellationToken ct)
    {
        return _queue.Writer.WriteAsync(userEvent, ct);
    }

    public ValueTask<UserStatusChangedEvent> DequeueAsync(CancellationToken ct)
    {
        return _queue.Reader.ReadAsync(ct);
    }
}

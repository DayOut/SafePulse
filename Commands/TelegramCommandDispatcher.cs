using HeartPulse.Commands.Interfaces;
using HeartPulse.DTOs;

namespace HeartPulse.Commands;

public class TelegramCommandDispatcher(IEnumerable<ITelegramCommandHandler> handlers) : ITelegramCommandDispatcher
{
    public async Task<TelegramCommandResult?> DispatchAsync(
        TelegramCommandContext context,
        CancellationToken ct)
    {
        foreach (var handler in handlers)
        {
            if (!handler.CanHandle(context))
                continue;

            var result = await handler.HandleAsync(context, ct);
            if (result is not null)
                return result;
        }

        return null;
    }
}
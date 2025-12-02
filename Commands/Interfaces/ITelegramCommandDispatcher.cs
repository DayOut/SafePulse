using HeartPulse.DTOs;

namespace HeartPulse.Commands.Interfaces;

public interface ITelegramCommandDispatcher
{
    Task<TelegramCommandResult?> DispatchAsync(TelegramCommandContext context, CancellationToken ct);
}
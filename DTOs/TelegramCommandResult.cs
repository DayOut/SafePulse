namespace HeartPulse.DTOs;

public record TelegramCommandResult(
    string? ReplyText,
    bool UseStatusKeyboard = true);
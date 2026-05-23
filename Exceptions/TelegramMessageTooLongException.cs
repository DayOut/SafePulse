using Telegram.Bot.Exceptions;

namespace HeartPulse.Exceptions;

public class TelegramMessageTooLongException : Exception
{
    private const int PreviewLength = 500;

    public TelegramMessageTooLongException(long chatId, string? text, Exception innerException)
        : base($"Telegram message is too long. ChatId: {chatId}, Length: {text?.Length ?? 0}, Preview: {BuildPreview(text)}", innerException)
    {
        ChatId = chatId;
        TextLength = text?.Length ?? 0;
        TextPreview = BuildPreview(text);
    }

    public long ChatId { get; }
    public int TextLength { get; }
    public string TextPreview { get; }

    public static bool IsTelegramMessageTooLong(ApiRequestException ex)
    {
        return ex.ErrorCode == 400 &&
            (ex.Message.Contains("message is too long", StringComparison.OrdinalIgnoreCase) ||
                ex.Message.Contains("text is too long", StringComparison.OrdinalIgnoreCase));
    }

    private static string BuildPreview(string? text)
    {
        if (string.IsNullOrEmpty(text))
            return string.Empty;

        var normalized = text
            .Replace("\r", "\\r", StringComparison.Ordinal)
            .Replace("\n", "\\n", StringComparison.Ordinal);

        return normalized.Length <= PreviewLength
            ? normalized
            : normalized[..PreviewLength] + "...";
    }
}

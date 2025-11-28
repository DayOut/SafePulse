namespace HeartPulse.Options;

public class TelegramOptions
{
    public string BotToken { get; set; } = "";
    public string? WebhookSecretToken { get; set; }
}
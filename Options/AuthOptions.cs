namespace HeartPulse.Options;

public class AuthOptions
{
    public string Issuer { get; set; } = "SafePulse";
    public string Audience { get; set; } = "SafePulse.Web";
    public string SigningKey { get; set; } = default!;
    public int AccessTokenMinutes { get; set; } = 15;
    public int RefreshTokenDays { get; set; } = 30;
    public int TelegramAuthMaxAgeMinutes { get; set; } = 15;
    public string[] BootstrapAdminTelegramIds { get; set; } = [];
    public string[] BootstrapAdminEmails { get; set; } = [];
    public bool EnableDevLogin { get; set; }
}

namespace HeartPulse.Options;

public class EmailVerificationOptions
{
    public int TokenDays { get; set; } = 7;
    public int ResendCooldownSeconds { get; set; } = 60;
}

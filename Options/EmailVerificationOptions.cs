namespace HeartPulse.Options;

public class EmailVerificationOptions
{
    public int TokenDays { get; set; } = 7;
    public int ResendCooldownSeconds { get; set; } = 60;

    // When true, accounts are treated as verified on registration and the
    // login gate is bypassed. Intended for demo environments without SMTP.
    public bool Skip { get; set; }
}

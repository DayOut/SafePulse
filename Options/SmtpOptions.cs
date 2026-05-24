namespace HeartPulse.Options;

public class SmtpOptions
{
    public string Host { get; set; } = default!;
    public int Port { get; set; } = 587;
    public string Username { get; set; } = default!;
    public string Password { get; set; } = default!;
    public string FromEmail { get; set; } = default!;
    public string FromName { get; set; } = "SafePulse";
    public bool UseStartTls { get; set; } = true;
}

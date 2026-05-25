using HeartPulse.Options;
using HeartPulse.Services.Interfaces;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Options;
using MimeKit;

namespace HeartPulse.Services;

public class MailKitEmailSender(IOptions<SmtpOptions> smtpOptions) : IEmailSender
{
    private readonly SmtpOptions _smtp = smtpOptions.Value;

    public async Task SendAsync(string to, string subject, string htmlBody, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_smtp.Host) || string.IsNullOrWhiteSpace(_smtp.FromEmail))
            throw new InvalidOperationException("SMTP is not configured (Smtp:Host and Smtp:FromEmail are required)");

        var message = new MimeMessage();
        message.From.Add(new MailboxAddress(_smtp.FromName, _smtp.FromEmail));
        message.To.Add(MailboxAddress.Parse(to));
        message.Subject = subject;
        message.Body = new TextPart("html") { Text = htmlBody };

        using var client = new SmtpClient();
        var socketOptions = _smtp.UseStartTls ? SecureSocketOptions.StartTls : SecureSocketOptions.Auto;
        await client.ConnectAsync(_smtp.Host, _smtp.Port, socketOptions, ct);
        await client.AuthenticateAsync(_smtp.Username, _smtp.Password, ct);
        await client.SendAsync(message, ct);
        await client.DisconnectAsync(true, ct);
    }
}

namespace HeartPulse.DTOs;

public class UserDto
{
    public string Id { get; set; } = default!;
    public string UserName { get; set; } = default!;
    public long? ChatId { get; set; }
    public string? TelegramUserId { get; set; }
    public string Status { get; set; } = default!;
    public DateTime LastActiveAt { get; set; }
    public DateTime LastSeenOnlineAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

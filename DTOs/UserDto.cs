namespace HeartPulse.DTOs;

public class UserDto
{
    public string Id { get; set; } = default!;
    public string UserName { get; set; } = default!;
    public string? Email { get; set; }
    public long? ChatId { get; set; }
    public string? TelegramUserId { get; set; }
    public string Language { get; set; } = "en";
    public string Status { get; set; } = default!;
    public bool TelegramNotificationsEnabled { get; set; }
    public bool TelegramNotificationsWhenOnline { get; set; }
    public DateTime LastActiveAt { get; set; }
    public DateTime LastSeenOnlineAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class UpdateLanguageRequest
{
    public string Language { get; set; } = default!;
}

public class UpdateProfileRequest
{
    public string? UserName { get; set; }
}

public class UpdateNotificationsRequest
{
    public bool TelegramNotificationsWhenOnline { get; set; }
}

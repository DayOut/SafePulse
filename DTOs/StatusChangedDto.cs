namespace HeartPulse.DTOs;

public class StatusChangedDto
{
    public string UserId { get; set; } = default!;
    public string UserName { get; set; } = default!;
    public string Status { get; set; } = default!;
    public DateTime LastActiveAt { get; set; }
    public DateTime LastSeenOnlineAt { get; set; }
    public IReadOnlyList<string> GroupIds { get; set; } = Array.Empty<string>();
}

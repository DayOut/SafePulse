namespace HeartPulse.DTOs;

public class UserDto
{
    public string Id { get; set; } = default!;
    public string Status { get; set; } = default!;
    public DateTime LastActiveAt { get; set; }
}
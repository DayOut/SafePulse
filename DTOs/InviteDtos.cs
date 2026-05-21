namespace HeartPulse.DTOs;

public class CreateInviteRequest
{
    public string? Note { get; set; }
}

public class InviteDto
{
    public string Id { get; set; } = default!;
    public string Token { get; set; } = default!;
    public string GroupId { get; set; } = default!;
    public string CreatedByUserId { get; set; } = default!;
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public string TelegramUrl { get; set; } = default!;
    public string ApiUrl { get; set; } = default!;
}

public class InvitePreviewDto
{
    public string Token { get; set; } = default!;
    public string GroupId { get; set; } = default!;
    public string GroupName { get; set; } = default!;
    public bool IsRevoked { get; set; }
}

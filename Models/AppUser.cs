using System.ComponentModel.DataAnnotations;
using MongoDB.Bson.Serialization.Attributes;

namespace HeartPulse.Models;

public class AppUser
{
    [Key]
    [BsonId]
    public string Id { get; set; } = default!;
    public string UserName { get; set; } = default!;
    public string? Email { get; set; }
    public string? NormalizedEmail { get; set; }
    public string? PasswordHash { get; set; }
    public string? TelegramUserId { get; set; }

    public DateTime LastActiveAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastSeenOnlineAt { get; set; }

    public UserStatus Status { get; set; } = UserStatus.Unknown;
    public long? ChatId { get; set; }
    public List<string>? Roles { get; set; }
    public bool? IsFake { get; set; }
    public bool? IsDeleted { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}

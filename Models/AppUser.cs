using System.ComponentModel.DataAnnotations;
using MongoDB.Bson.Serialization.Attributes;

namespace HeartPulse.Models;

public class AppUser
{
    [Key]
    [BsonId]
    public string Id { get; set; } = default!;
    public string UserName { get; set; } = default!;

    public DateTime LastActiveAt { get; set; } = DateTime.UtcNow;

    public UserStatus Status { get; set; } = UserStatus.Unknown;
    public long? ChatId { get; set; }
    public bool? IsDeleted { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}

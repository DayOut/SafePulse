using System.ComponentModel.DataAnnotations;
using MongoDB.Bson.Serialization.Attributes;

namespace HeartPulse.Models;

public class AppUser
{
    // Для простоти використаємо Telegram UserId як Id (рядок).
    [Key]
    [BsonId]
    public string Id { get; set; } = default!;
    public string UserName { get; set; }

    public DateTime LastActiveAt { get; set; } = DateTime.UtcNow;

    public UserStatus Status { get; set; } = UserStatus.Unknown;
    public long? ChatId { get; set; }
}
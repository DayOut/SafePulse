using System.ComponentModel.DataAnnotations;
using MongoDB.Bson.Serialization.Attributes;

namespace HeartPulse.Models;

public class Group
{
    [Key]
    [BsonId]
    public string Id { get; set; } = default!;
    public string Name { get; set; } = default!;
    public string OwnerId { get; set; } = default!;
    public bool? IsDeleted { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}

using System.ComponentModel.DataAnnotations;
using MongoDB.Bson.Serialization.Attributes;

namespace HeartPulse.Models;

public class GroupStatusRequest
{
    [Key]
    [BsonId]
    public string Id { get; set; } = default!;
    public string GroupId { get; set; } = default!;
    public string RequestedByUserId { get; set; } = default!;
    public string RequestedByUserName { get; set; } = default!;
    public DateTime CreatedAt { get; set; }
}

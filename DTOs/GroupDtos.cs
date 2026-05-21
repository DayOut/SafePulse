namespace HeartPulse.DTOs;

public class GroupDto
{
    public string Id { get; set; } = default!;
    public string Name { get; set; } = default!;
    public string OwnerId { get; set; } = default!;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class CreateGroupRequest
{
    public string Name { get; set; } = default!;
}

public class UpdateGroupRequest
{
    public string? Name { get; set; }
}

public class GroupMemberDto
{
    public string Id { get; set; } = default!;
    public string UserName { get; set; } = default!;
    public string Status { get; set; } = default!;
    public DateTime LastActiveAt { get; set; }
}

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
    public string Role { get; set; } = default!;
    public bool CanManage { get; set; }
    public DateTime LastActiveAt { get; set; }
    public DateTime LastSeenOnlineAt { get; set; }
}

public class MyGroupDto
{
    public string Id { get; set; } = default!;
    public string Name { get; set; } = default!;
    public string OwnerId { get; set; } = default!;
    public IReadOnlyList<GroupMemberDto> Members { get; set; } = Array.Empty<GroupMemberDto>();
}

public class UpdateGroupMemberRoleRequest
{
    public string Role { get; set; } = default!;
}

public class GroupStatusRequestDto
{
    public string Id { get; set; } = default!;
    public string GroupId { get; set; } = default!;
    public string RequestedByUserId { get; set; } = default!;
    public string RequestedByUserName { get; set; } = default!;
    public DateTime CreatedAt { get; set; }
}

public class GroupStatusRequestedDto
{
    public string Id { get; set; } = default!;
    public string GroupId { get; set; } = default!;
    public string GroupName { get; set; } = default!;
    public string RequestedByUserId { get; set; } = default!;
    public string RequestedByUserName { get; set; } = default!;
    public DateTime CreatedAt { get; set; }
}

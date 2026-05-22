namespace HeartPulse.DTOs;

public class CreateUserRequest
{
    public string? Id { get; set; }
    public string UserName { get; set; } = default!;
    public long? ChatId { get; set; }
    public string? Status { get; set; }
}

public class UpdateUserRequest
{
    public string? UserName { get; set; }
    public long? ChatId { get; set; }
    public string? Status { get; set; }
}

public class UpdateUserStatusRequest
{
    public string Status { get; set; } = default!;
}

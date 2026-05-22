using System.Text.Json.Serialization;

namespace HeartPulse.DTOs;

public class TelegramLoginRequest
{
    [JsonPropertyName("id")]
    public long Id { get; set; }

    [JsonPropertyName("first_name")]
    public string? FirstName { get; set; }

    [JsonPropertyName("last_name")]
    public string? LastName { get; set; }

    [JsonPropertyName("username")]
    public string? Username { get; set; }

    [JsonPropertyName("photo_url")]
    public string? PhotoUrl { get; set; }

    [JsonPropertyName("auth_date")]
    public long AuthDate { get; set; }

    [JsonPropertyName("hash")]
    public string Hash { get; set; } = default!;
}

public class DevLoginRequest
{
    public string UserId { get; set; } = default!;
    public string UserName { get; set; } = default!;
}

public class RegisterRequest
{
    public string Email { get; set; } = default!;
    public string UserName { get; set; } = default!;
    public string Password { get; set; } = default!;
}

public class LoginRequest
{
    public string Email { get; set; } = default!;
    public string Password { get; set; } = default!;
}

public class AuthResponse
{
    public string AccessToken { get; set; } = default!;
    public DateTime AccessTokenExpiresAt { get; set; }
    public UserDto User { get; set; } = default!;
}

public class TelegramLinkCodeDto
{
    public string Id { get; set; } = default!;
    public string Code { get; set; } = default!;
    public DateTime ExpiresAt { get; set; }
}

public class TelegramLinkStatusDto
{
    public string Id { get; set; } = default!;
    public bool IsConsumed { get; set; }
    public bool IsExpired { get; set; }
    public DateTime ExpiresAt { get; set; }
}

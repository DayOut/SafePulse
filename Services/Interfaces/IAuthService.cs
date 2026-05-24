using HeartPulse.DTOs;
using HeartPulse.Models;

namespace HeartPulse.Services.Interfaces;

public interface IAuthService
{
    Task<AppUser> RegisterWithPasswordAsync(
        string email,
        string userName,
        string password,
        CancellationToken ct);

    Task<(AppUser User, string AccessToken, DateTime AccessTokenExpiresAt, string RefreshToken)> LoginWithPasswordAsync(
        string email,
        string password,
        CancellationToken ct);

    Task<(AppUser User, string AccessToken, DateTime AccessTokenExpiresAt, string RefreshToken)> LoginWithTelegramAsync(
        TelegramLoginRequest request,
        CancellationToken ct);

    Task<(AppUser User, string AccessToken, DateTime AccessTokenExpiresAt, string RefreshToken)?> RefreshAsync(
        string refreshToken,
        CancellationToken ct);

    Task RevokeRefreshTokenAsync(string refreshToken, CancellationToken ct);

    Task<(AppUser User, string AccessToken, DateTime AccessTokenExpiresAt, string RefreshToken)> IssueSessionForVerifiedUserAsync(
        AppUser user,
        CancellationToken ct);

    Task<(AppUser User, string AccessToken, DateTime AccessTokenExpiresAt, string RefreshToken)> DevLoginAsync(
        string userId,
        string userName,
        CancellationToken ct);
}

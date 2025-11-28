using System.Net;
using System.Text;
using HeartPulse.Controllers;
using HeartPulse.Data;
using HeartPulse.DTOs;
using HeartPulse.Models;
using HeartPulse.Notifiers.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace HeartPulse.Notifiers.Builders;

public class GroupNotificationBuilder : IGroupNotificationBuilder
{
    private readonly SafePulseContext _db;

    public GroupNotificationBuilder(SafePulseContext db)
    {
        _db = db;
    }

    public async Task<IReadOnlyList<GroupStatusNotification>> BuildStatusNotificationsAsync(
        AppUser changedUser,
        CancellationToken ct)
    {
        var result = new List<GroupStatusNotification>();

        var groupIds = await _db.GroupUsers
            .Where(gu => gu.UserId == changedUser.Id)
            .Select(gu => gu.GroupId)
            .Distinct()
            .ToListAsync(ct);

        if (groupIds.Count == 0)
            return result;

        foreach (var groupId in groupIds)
        {
            var group = await _db.Groups
                .FirstOrDefaultAsync(g => g.Id == groupId, ct);
            if (group is null)
                continue;

            var memberIds = await _db.GroupUsers
                .Where(gu => gu.GroupId == groupId)
                .Select(gu => gu.UserId)
                .ToListAsync(ct);

            if (memberIds.Count == 0)
                continue;

            var members = await _db.Users
                .Where(u => memberIds.Contains(u.Id))
                .ToListAsync(ct);

            if (members.Count == 0)
                continue;

            var safeGroupName = WebUtility.HtmlEncode(group.Name);
            var inviteLink = $"https://t.me/{TelegramController.BotUsername}?start=join_{group.Id}";
            var safeInviteLink = WebUtility.HtmlEncode(inviteLink);

            var sb = new StringBuilder();
            sb.AppendLine($"<b>Оновлення статусів у групі</b> " +
                          $"<a href=\"{safeInviteLink}\">{safeGroupName}</a>");
            sb.AppendLine();

            foreach (var member in members)
            {
                var userName = WebUtility.HtmlEncode(member.UserName ?? member.Id);
                var time = member.LastActiveAt.ToString("HH:mm:ss");

                if (changedUser.Id == member.Id)
                    sb.AppendLine($"• <b><u>{userName}: {member.Status.ToString()} ({time})</u></b>");
                else
                    sb.AppendLine($"• {userName}: {member.Status.ToString()} ({time})");
            }

            var text = sb.ToString();

            foreach (var member in members)
            {
                if (member.ChatId.HasValue)
                {
                    result.Add(new GroupStatusNotification(member.ChatId.Value, text));
                }
            }
        }

        return result;
    }
}
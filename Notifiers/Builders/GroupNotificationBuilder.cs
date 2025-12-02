using System.Net;
using System.Text;
using HeartPulse.Controllers;
using HeartPulse.Data;
using HeartPulse.DTOs;
using HeartPulse.Formatters;
using HeartPulse.Formatters.Interfaces;
using HeartPulse.Models;
using HeartPulse.Notifiers.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace HeartPulse.Notifiers.Builders;

public class GroupNotificationBuilder(SafePulseContext db, ITelegramTextFormatter formatter) : IGroupNotificationBuilder
{
    public async Task<IReadOnlyList<GroupStatusNotification>> BuildStatusNotificationsAsync(
        AppUser changedUser,
        CancellationToken ct)
    {
        var result = new List<GroupStatusNotification>();

        var groupIds = await db.GroupUsers
            .Where(gu => gu.UserId == changedUser.Id)
            .Select(gu => gu.GroupId)
            .Distinct()
            .ToListAsync(ct);

        if (groupIds.Count == 0)
            return result;

        foreach (var groupId in groupIds)
        {
            var group = await db.Groups
                .FirstOrDefaultAsync(g => g.Id == groupId, ct);
            if (group is null)
                continue;

            var memberIds = await db.GroupUsers
                .Where(gu => gu.GroupId == groupId)
                .Select(gu => gu.UserId)
                .ToListAsync(ct);

            if (memberIds.Count == 0)
                continue;

            var members = await db.Users
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
                var time = member.LastActiveAt.ToHumanTime();

                if (changedUser.Id == member.Id)
                    sb.AppendLine($"- <b><u>{userName}: {formatter.FormatStatus(member.Status)} ({time})</u></b>");
                else
                    sb.AppendLine($"- {userName}: {formatter.FormatStatus(member.Status)} ({time})");
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
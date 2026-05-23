using System.Net;
using System.Text;
using HeartPulse.Controllers;
using HeartPulse.Data;
using HeartPulse.DTOs;
using HeartPulse.Formatters;
using HeartPulse.Formatters.Interfaces;
using HeartPulse.Models;
using HeartPulse.Notifiers.Interfaces;
using HeartPulse.Options;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace HeartPulse.Notifiers.Builders;

public class GroupNotificationBuilder(
    SafePulseContext db,
    ITelegramTextFormatter formatter,
    IOptions<AppOptions> appOptions) : IGroupNotificationBuilder
{
    private const int CompactGroupMemberThreshold = 20;
    private readonly AppOptions _appOptions = appOptions.Value;

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

            var text = members.Count > CompactGroupMemberThreshold
                ? BuildCompactStatusText(group, members)
                : BuildFullStatusText(group, members, changedUser.Id);

            foreach (var member in members)
            {
                if (member.ChatId.HasValue && member.TelegramNotificationsEnabled != false)
                {
                    result.Add(new GroupStatusNotification(member.ChatId.Value, group.Id, text));
                }
            }
        }

        return result;
    }

    private string BuildFullStatusText(Group group, IReadOnlyList<AppUser> members, string changedUserId)
    {
        var safeGroupName = WebUtility.HtmlEncode(group.Name);
        var groupLink = WebUtility.HtmlEncode(BuildGroupLink(group));

        var sb = new StringBuilder();
        sb.AppendLine($"<b>Оновлення статусів у групі</b> <a href=\"{groupLink}\">{safeGroupName}</a>");
        sb.AppendLine();

        foreach (var member in members)
        {
            var userName = WebUtility.HtmlEncode(member.UserName ?? member.Id);
            var time = member.LastActiveAt.ToHumanTime();

            if (changedUserId == member.Id)
                sb.AppendLine($"- <b><u>{userName}: {formatter.FormatStatus(member.Status)} ({time})</u></b>");
            else
                sb.AppendLine($"- {userName}: {formatter.FormatStatus(member.Status)} ({time})");
        }

        return sb.ToString();
    }

    private string BuildCompactStatusText(Group group, IReadOnlyList<AppUser> members)
    {
        var safeGroupName = WebUtility.HtmlEncode(group.Name);
        var groupLink = WebUtility.HtmlEncode(BuildGroupLink(group));
        var needHelpMembers = members
            .Where(member => member.Status == UserStatus.NeedHelp)
            .OrderByDescending(member => member.LastActiveAt)
            .ToList();

        var sb = new StringBuilder();
        sb.AppendLine($"<b>Оновлення статусів у великій групі</b> <a href=\"{groupLink}\">{safeGroupName}</a>");
        sb.AppendLine($"У групі {members.Count} учасників. Повний список дивись у web UI.");
        sb.AppendLine();

        if (needHelpMembers.Count == 0)
        {
            sb.AppendLine("Зараз немає учасників зі статусом \"Потребую допомоги\".");
            return sb.ToString();
        }

        sb.AppendLine($"<b>Потребують допомоги: {needHelpMembers.Count}</b>");
        foreach (var member in needHelpMembers)
        {
            var userName = WebUtility.HtmlEncode(member.UserName ?? member.Id);
            var time = member.LastActiveAt.ToHumanTime();
            sb.AppendLine($"- {userName} ({time})");
        }

        return sb.ToString();
    }

    private string BuildGroupLink(Group group)
    {
        var publicBaseUrl = _appOptions.PublicBaseUrl?.Trim().TrimEnd('/');
        if (string.IsNullOrWhiteSpace(publicBaseUrl))
            return $"https://t.me/{TelegramController.BotUsername}?start=join_{group.Id}";

        return $"{publicBaseUrl}/?groupId={Uri.EscapeDataString(group.Id)}";
    }
}

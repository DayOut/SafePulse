using System.Text;
using HeartPulse.Commands.Interfaces;
using HeartPulse.Controllers;
using HeartPulse.DTOs;
using HeartPulse.Notifiers.Interfaces;
using HeartPulse.Services.Interfaces;

namespace HeartPulse.Commands.Handlers;

public class CreateGroupCommandHandler(
    IGroupService groupService,
    IGroupNotifier  groupNotifier)
    : ITelegramCommandHandler
{
    public bool CanHandle(TelegramCommandContext context)
    {
        return context.RawText.Contains("/create");
    }

    public async Task<TelegramCommandResult?> HandleAsync(
        TelegramCommandContext context,
        CancellationToken ct)
    {
        var namePart = context.RawText.Substring("/create".Length).Trim();
        var sb = new StringBuilder();
        
        if (string.IsNullOrWhiteSpace(namePart))
        {
            sb.Append("Будь ласка\\, надішли команду у форматі\\:\n/create Назва моєї групи");
            return new TelegramCommandResult(sb.ToString());
        }

        if (await groupService.IsGroupNameExistAsync(namePart, ct))
        {
            sb.Append("Така група вже існує");
            return new TelegramCommandResult(sb.ToString());
        }
        
        var group = await groupService.CreateAsync(context.User.Id, namePart, ct);
        
        var inviteLink = $"https://t.me/{TelegramController.BotUsername}?start=join_{group.Id}";
        
        await groupNotifier.SendMessageAsync(inviteLink, context.User, ct);
        
        sb.AppendLine($"Група \"{group.Name}\" готова\\.\n" +
                      "Ти доданий до неї\\. Надішли це посилання іншим, щоб запросити їх:");
        
        return new TelegramCommandResult(sb.ToString());
    }
}
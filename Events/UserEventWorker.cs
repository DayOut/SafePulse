namespace HeartPulse.Events;

public class UserEventWorker(
    IUserEventQueue queue,
    IServiceScopeFactory scopeFactory,
    ILogger<UserEventWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            UserStatusChangedEvent userEvent;
            try
            {
                userEvent = await queue.DequeueAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }

            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                var handlers = scope.ServiceProvider.GetServices<IUserStatusChangedEventHandler>();
                foreach (var handler in handlers)
                {
                    try
                    {
                        await handler.HandleAsync(userEvent, stoppingToken);
                    }
                    catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                    {
                        throw;
                    }
                    catch (Exception ex)
                    {
                        logger.LogWarning(
                            ex,
                            "Failed to run {Handler} for user status event {UserId} from {Source}",
                            handler.GetType().Name,
                            userEvent.User.Id,
                            userEvent.Source);
                    }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogWarning(
                    ex,
                    "Failed to process user status event for user {UserId} from {Source}",
                    userEvent.User.Id,
                    userEvent.Source);
            }
        }
    }
}

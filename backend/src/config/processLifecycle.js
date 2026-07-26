function fatal(event, error, dependencies = {}) {
    const processRef = dependencies.processRef || process;
    const log = dependencies.log || console.error;
    const schedule = dependencies.schedule || setTimeout;

    log(`${event}:`, error);
    processRef.exitCode = 1;
    const timer = schedule(() => processRef.exit(1), 100);
    timer.unref?.();
}

module.exports = { fatal };

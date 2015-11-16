/* global EslintLinter:true */

const CLIEngine = Npm.require('eslint').CLIEngine;
const yaml = Npm.require('js-yaml');
const stripJsonComments = Npm.require('strip-json-comments');
const chalk = Npm.require('chalk');

const printDebugMessage = (file, message) => {
  file.error({message});
};

class EslintConfig {
  constructor() {
    this.cliParams = {
      baseConfig: null, // json object
      ignorePattern: null, // [string]
    };
    this.hashes = {
      configHash: null, // string
      ignoreHash: null, // string
    };
    this.archSpecific = {}; // { [arch] -> {globals, globalsString} }
    this.messageCache = {}; // { [pathInPackage,arch] -> { hash, messages }}}
  }

  configChanged(configHash) {
    return (configHash && this.hashes.configHash !== configHash)
      || (!configHash && this.hashes.configHash);
  }

  ignoreChanged(ignoreHash) {
    return (ignoreHash && this.hashes.ignoreHash !== ignoreHash)
      || (!ignoreHash && this.hashes.ignoreHash);
  }

  globalsChanged(arch, globalsString) {
    const archSpecific = this.archSpecific[arch];
    return !archSpecific || (globalsString && archSpecific.globalsString !== globalsString)
      || (!globalsString && archSpecific.globalsString);
  }

  setConfigFromString(configHash, configString) {
    this.hashes.configHash = configHash;
    try {
      this.cliParams.baseConfig = yaml.safeLoad(stripJsonComments(configString));
    } catch (err) {
      this.cliParams.baseConfig = null;
      throw err;
    }
  }

  setIgnoreFromString(ignoreHash, ignoreString) {
    this.hashes.ignoreHash = ignoreHash;
    try {
      this.cliParams.ignorePattern = ignoreString.split('\n').filter((line) => {
        return line.length > 0;
      });
    } catch (err) {
      this.cliParams.ignorePattern = null;
      throw err;
    }
  }

  setGlobals(arch, globalsString, globals) {
    if (!this.archSpecific[arch]) {
      this.archSpecific[arch] = {
        globalsString: null,
        globals: null
      };
    }
    this.archSpecific[arch].globalsString = globalsString;
    this.archSpecific[arch].globals = globals;
  }

  cachedMessages(cacheKey, hash) {
    return this.messageCache.hasOwnProperty(cacheKey)
      && this.messageCache[cacheKey].hash === hash
      && this.messageCache[cacheKey].messages;
  }

  cache(cacheKey, cacheData) {
    this.messageCache[cacheKey] = cacheData;
  }

  clearMessageCache() {
    this.messageCache = {};
  }
}

class EslintLinter {
  constructor() {
    console.log("CONSTRUCTING")
    this._cacheByPackage = {};
  }

  getDefaultConfig() {
    // TODO: why can't we cache as this._defaultConfig?
    const cli = new CLIEngine({useEslintrc: false, baseConfig: {},
      configFile: 'packages/eslint/config/.eslintrc-default'});
    return cli.getConfigForFile();
  }

  getConfigFile(files, configFilename) {
    const packageName = files[0].getPackageName();
    const configs = files.filter((file) => {
      return file.getBasename() === configFilename;
    });
    const configFile = configs[0];
    if (configs.length > 1) {
      const configList = configs.map((c) => c.getPathInPackage()).join(', ');
      configFile.error({
        message: `Found multiple ${configFilename} files in package ${packageName}: ${configList}`
      });
    }
    return configFile;
  }

  getPackageConfig(files, globals) {
    const packageName = files[0].getPackageName() || '*app*';
    const arch = files[0].getArch();
    let config = this._cacheByPackage[packageName];

    // check for changes in .eslintrc config
    const eslintRc = this.getConfigFile(files, '.eslintrc');
    const eslintRcHash = eslintRc ? eslintRc.getSourceHash() : null;
    const eslintRcString = eslintRc ? eslintRc.getContentsAsString() : null;

    if (!config) {
      printDebugMessage(eslintRc, `Creating eslint config for ${packageName}`);
      config = new EslintConfig();
    }

    if (config.configChanged(eslintRcHash, eslintRcString)) {
      try {
        config.setConfigFromString(eslintRcHash, eslintRcString);
      } catch (err) {
        eslintRc.error({
          message:
            `Failed to parse ${eslintRc.getPathInPackage()}: not valid JSON: ${err.message}`
        });
      }
      printDebugMessage(eslintRc, 'loading eslintrc');
      config.clearMessageCache();
    }

    // check for changes in .eslintignore config
    const eslintIgnore = this.getConfigFile(files, '.eslintignore');
    const eslintIgnoreHash = eslintIgnore ? eslintIgnore.getSourceHash() : null;
    const eslintIgnoreString = eslintIgnore ? eslintIgnore.getContentsAsString() : null;
    if (config.ignoreChanged(eslintIgnoreHash, eslintIgnoreString)) {
      try {
        config.setIgnoreFromString(eslintIgnoreHash, eslintIgnoreString);
      } catch (err) {
        eslintIgnore.error({
          message:
            `Failed to parse ${eslintIgnore.getPathInPackage()}: not valid JSON: ${err.message}`
        });
      }
      printDebugMessage(eslintIgnore, 'loading eslintignore');
      config.clearMessageCache();
    }

    // check for changes in the globals
    const globalsString = globals.length ? globals.join(',') : null;
    if (config.globalsChanged(arch, globalsString)) {
      config.setGlobals(arch, globalsString, globals);
      config.clearMessageCache();
      printDebugMessage(eslintRc, 'loading globals');
    }

    // Store the cached config
    this._cacheByPackage[packageName] = config;
    return config;
  }

  processFilesForPackage(files, options) {
    // Assumes that this method gets called once per package.

    // TODO: if we wanted to provide a default config, we could use this.getDefaultConfig() and
    // merge via https://github.com/eslint/eslint/blob/v1.9.0/lib/util.js#L25
    const eslintConfig = this.getPackageConfig(files, options.globals);

    // We use a CLIEngine here instead of 'verify', since the CLIEngine seems to be the only
    // way to load eslint plugins [babel, react].

    // Don't use .eslintrc's or .eslintignore's since we are running in the context of
    // a build plugin, not the real file system.  If we had a reliable way to translate the `file`
    // object into the original path on disk, we could probably just lint the file in it's original
    // filesystem context, which may or may not be a better idea.
    const arch = files[0].getArch();
    const cliParams = _.extend({
      useEslintrc: false,
      globals: eslintConfig.archSpecific[arch].globals
    }, eslintConfig.cliParams);
    const packageCli = new CLIEngine(cliParams);

    files.forEach((file) => {
      // skip linting config files
      if (file.getBasename() === '.eslintrc' || file.getBasename() === '.eslintignore') {
        return;
      }
      // skip files we already linted
      const cacheKey = JSON.stringify([file.getPathInPackage(), file.getArch()]);
      const cachedMessages = eslintConfig.cachedMessages(cacheKey, file.getSourceHash());
      if (cachedMessages) {
        printDebugMessage(file, 'loading from cache');
        this.logPluginResults(file, cachedMessages);
        return;
      }

      const report = packageCli.executeOnText(file.getContentsAsString(), file.getPathInPackage());
      const messages = report.results && report.results[0] && report.results[0].messages;
      eslintConfig.cache(cacheKey, {hash: file.getSourceHash(), messages: messages});
      if (messages && messages.length) {
        this.logPluginResults(file, messages);
      }
    });
  }

  logPluginResults(file, messages) {
    messages.forEach((m) => {
      const severity = m.severity === 1 ? chalk.yellow('WARNING: ') : chalk.red('ERROR: ');
      let text = severity + m.message;
      if (m.ruleId) {
        text += chalk.dim(` [${m.ruleId}]`);
      } else if (m.source) {
        text += chalk.dim(` [${m.source}]`);
      }
      const entry = {
        message: text,
        line: m.line,
        column: m.column
      };
      file.error(entry);
    });
  }
}

Plugin.registerLinter({
  extensions: ['js', 'jsx'],
  filenames: ['.eslintrc', '.eslintignore']
}, () => {
  return new EslintLinter();
});

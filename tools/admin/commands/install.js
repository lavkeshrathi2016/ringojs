const log = require("ringo/logging").getLogger(module.id);
const term = require("ringo/term");
const {Parser} = require("ringo/args");
const fs = require("fs");

const constants = require("../constants");
const packages = require("../utils/packages");
const specs = require("../utils/specs");
const files = require("../utils/files");
const httpClient = require("../utils/httpclient");
const archive = require("../utils/archive");
const git = require("../utils/git");
const shell = require("../utils/shell");

const parser = new Parser();
parser.addOption("g", "global", null, "Install package globally");
parser.addOption("f", "force", null, "Answer all prompts with 'yes'");
parser.addOption("n", "no-deps", null, "Skip installing dependencies");
parser.addOption("h", "help", null, "Print help message and exit");

const DEFAULT_OPTIONS = {
    force: false,
    noDeps: false
};

exports.description = "Install package(s)"

exports.help = [
    "\n" + exports.description + "\n",
    "Usage:",
    "  ringo-admin install (no args, in package directory)",
    "  ringo-admin install http(s)://example.com/path/archive.<tar|tar.gz|tgz|zip>",
    "  ringo-admin install <github owner>/<github repo>",
    "  ringo-admin install https://github.com/<owner>/<repo>[#<tree-ish>]",
    "  ringo-admin install <git|git+ssh|ssh|git+http|git+https|git+file>://<url>[#<tree-ish>]",
    "\nOptions:",
    parser.help(),
    ""
].join("\n");

exports.run = (args) => {
    const options = Object.assign({}, DEFAULT_OPTIONS);
    try {
        parser.parse(args, options);
    } catch (e) {
        term.writeln(term.RED, e.message, term.RESET);
        term.writeln("Available options:");
        term.writeln(parser.help());
        return;
    }
    if (options.help) {
        term.writeln(exports.help);
        return;
    }
    const baseDirectory = (options.global === true) ?
        packages.getRingoHome() :
        packages.getBaseDirectory();
    const packagesDirectory = packages.getPackagesDirectory(baseDirectory);
    if (!fs.exists(packagesDirectory)) {
        log.debug("Created packages directory", packagesDirectory);
        fs.makeDirectory(packagesDirectory);
    }
    if (args.length === 0) {
        const descriptor = packages.getDescriptor(baseDirectory);
        if (!descriptor) {
            throw new Error("No package.json file found in " + baseDirectory);
        }
        installDependencies(descriptor, packagesDirectory, options);
    } else {
        return args.map(url => {
            return installPackage(url, packagesDirectory, options);
        });
    }
};

const confirmInstall = (name, installDirectory, force) => {
    if (fs.exists(installDirectory)) {
        log.info("Install directory exists:", installDirectory);
        if (force !== true) {
            term.writeln(term.RED, "The package", name, "is already installed in",
                installDirectory, term.RESET);
            if (!shell.continue("n")) {
                log.info("User aborted installation of {} to {}", name, installDirectory);
                term.writeln("Aborted");
                return false;
            }
        }
        log.info("Removing install directory {} (force: {})", installDirectory, force);
        fs.removeTree(installDirectory);
        return true;
    }
    return true;
};

const installDependencies = exports.installDependencies = (descriptor, packagesDirectory, options) => {
    options || (options = DEFAULT_OPTIONS);
    log.info("Installing dependencies of {} (options: {}) ...", descriptor.name, JSON.stringify(options));
    term.writeln("Installing dependencies of", descriptor.name, "...");
    const {dependencies} = descriptor;
    Object.keys(dependencies).forEach(dependency => {
        const url = dependencies[dependency];
        if (!specs.isValidUrl(url)) {
            log.warn("Dependency {} of {} has an invalid package url '{}'",
                    dependency, descriptor.name, url);
            term.writeln(term.RED, "Dependency", dependency, "of", descriptor.name,
                    "has an invalid package url '" + url + "'", term.RESET);
        } else {
            installPackage(url, packagesDirectory, options);
        }
    });
};

const installPackage = exports.installPackage = (url, packagesDirectory, options) => {
    options || (options = DEFAULT_OPTIONS);
    if (!specs.isValidUrl(url)) {
        log.warn("Invalid package url '{}'", url);
        term.writeln(term.RED, "Invalid package url '" + url + "'", term.RESET);
        return;
    }
    const spec = specs.get(url);
    switch (spec.type) {
        case constants.TYPE_ARCHIVE:
            installArchive(spec, packagesDirectory, options);
            break;
        case constants.TYPE_GIT:
            installGit(spec, packagesDirectory, options);
            break;
        default:
            throw new Error("Unknown spec type '" + spec.type + "'");
    }
};

const installArchive = exports.installArchive = (spec, packagesDirectory, options) => {
    options || (options = DEFAULT_OPTIONS);
    log.info("Installing package from {} (options: {})", spec.url, JSON.stringify(options));
    term.writeln("Installing package from", spec.url);
    const tempArchive = httpClient.getBinary(spec.url);
    const tempDirectory = archive.extract(tempArchive);
    const descriptor = packages.getDescriptor(tempDirectory);
    if (!descriptor) {
        throw new Error("Missing or invalid package.json in " + spec.url);
    }
    const installDirectory = files.getInstallDirectory(packagesDirectory, descriptor.name);
    if (!confirmInstall(descriptor.name, installDirectory, options.force === true)) {
        log.info("Removing temporary directory", tempDirectory);
        fs.removeTree(tempDirectory);
    } else {
        archive.install(tempDirectory, installDirectory);
        term.writeln(term.GREEN, "Installed", descriptor.name, "(" + descriptor.version + ") in", installDirectory, term.RESET);
        log.info("Installed package from {} to {}", spec.url, installDirectory);
        if (packages.hasDependencies(descriptor) && options.noDeps !== true) {
            installDependencies(descriptor, packagesDirectory, options);
        }
    }
};

const installGit = exports.installGit = (spec, packagesDirectory, options) => {
    options || (options = DEFAULT_OPTIONS);
    log.info("Installing git repository from {} (tree-ish: {}, options: {})",
            spec.url, spec.treeish, JSON.stringify(options));
    const tempDirectory = git.clone(spec.url, spec.treeish);
    const descriptor = packages.getDescriptor(tempDirectory);
    if (!descriptor) {
        throw new Error("Missing or invalid package.json in " + spec.url);
    }
    const installDirectory = files.getInstallDirectory(packagesDirectory, descriptor.name);
    if (!confirmInstall(descriptor.name, installDirectory, options.force === true)) {
        log.info("Removing temporary directory", tempDirectory);
        fs.removeTree(tempDirectory);
    } else {
        log.info("Creating install directory", installDirectory);
        fs.makeDirectory(installDirectory, 0o755);
        git.install(tempDirectory, installDirectory);
        log.info("Removed temporary directory", tempDirectory);
        fs.removeTree(tempDirectory);
        log.info("Installed git repository {} to {}", spec.url, installDirectory);
        term.writeln(term.GREEN, "Installed", descriptor.name, "(" + descriptor.version + ")", "in", installDirectory, term.RESET);
        if (packages.hasDependencies(descriptor) && options.noDeps !== true) {
            installDependencies(descriptor, packagesDirectory, options);
        }
    }
};

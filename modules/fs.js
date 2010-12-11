/**
 * @fileoverview <p>This module provides file and path related functionality as
 * defined by the <a href="http://wiki.commonjs.org/wiki/Filesystem/A">CommonJS
 * Filesystem/A</a> proposal.
 *
 * The "fs" module provides a file system API for the manipulation of paths,
 * directories, files, links, and the construction of file streams.
 */

var arrays = require('ringo/utils/arrays');
include('io');
include('binary');

var File = java.io.File,
    FileInputStream = java.io.FileInputStream,
    FileOutputStream = java.io.FileOutputStream;

var SEPARATOR = File.separator;
var SEPARATOR_RE = SEPARATOR == '/' ?
                   new RegExp(SEPARATOR) :
                   new RegExp(SEPARATOR.replace("\\", "\\\\") + "|/");

var POSIX;

function getPOSIX() {
    POSIX = POSIX || org.ringojs.wrappers.POSIX.getPOSIX();
    return POSIX;
}

export('absolute',
       'base',
       'copy',
       'copyTree',
       'directory',
       'extension',
       'isAbsolute', // non-standard/non-spec
       'isRelative', // non-standard/non-spec
       'join',
       'makeTree',
       'listDirectoryTree',
       'listTree',
       'normal',
       'open',
       'path',
       'Path',
       'read',
       'relative',
       'removeTree',
       'resolve',
       'write',
       'split',
       // previously in fs-base
       'canonical',
       'changeWorkingDirectory',
       'workingDirectory',
       'exists',
       'isDirectory',
       'isFile',
       'isReadable',
       'isWritable',
       'list',
       'makeDirectory',
       'move',
       'lastModified',
       'openRaw',
       'remove',
       'removeDirectory',
       'size',
       'touch',
       'symbolicLink',
       'hardLink',
       'readLink',
       'isLink',
       'same',
       'sameFilesystem',
       'iterate',
       'Permissions',
       'owner',
       'group',
       'changePermissions',
       'changeOwner',
       'changeGroup',
       'permissions');

/**
 * Open an IO stream for reading/writing to the file corresponding to the given
 * path.
 */
function open(path, options) {
    options = checkOptions(options);
    var file = resolveFile(path);
    var {read, write, append, update, binary, charset} = options;
    if (!read && !write && !append && !update) {
        read = true;
    }
    var stream = new Stream(read ?
            new FileInputStream(file) : new FileOutputStream(file, Boolean(append)));
    if (binary) {
        return stream;
    } else if (read || write || append) {
        return new TextStream(stream, charset);
    } else if (update) {
        throw new Error("update not yet implemented");
    }
}

function openRaw(path, mode, permissions) {
    // TODO many things missing here
    var file = resolveFile(path);
    mode = mode || {};
    var {read, write, append, create, exclusive, truncate} = mode;
    if (!read && !write && !append) {
        read = true;
    }
    if (read) {
        return new Stream(new FileInputStream(file));
    } else {
        return new Stream(FileOutputStream(file, Boolean(append)));
    }
}


/**
 * Open, read, and close a file, returning the file's contents.
 */
function read(path, options) {
    options = options === undefined ? {} : checkOptions(options);
    options.read = true;
    var stream = open(path, options);
    try {
        return stream.read();
    } finally {
        stream.close();
    }
}

/**
 * Open, write, flush, and close a file, writing the given content. If
 * content is a binary.ByteArray or binary.ByteString, binary mode is implied.
 */
function write(path, content, options) {
    options = options === undefined ? {} : checkOptions(options)
    options.write = true
    options.binary = content instanceof Binary
    var stream = open(path, options);
    try {
        stream.write(content);
        stream.flush();
    } finally {
        stream.close();
    }
}

/**
 * Read data from one file and write it into another using binary mode.
 */
function copy(from, to) {
    var source = resolveFile(from);
    var target = resolveFile(to);
    var input = new FileInputStream(source).getChannel();
    var output = new FileOutputStream(target).getChannel();
    var size = source.length();
    try {
        input.transferTo(0, size, output);
    } finally {
        input.close();
        output.close();
    }
}

/**
 * Copy files from a source path to a target path. Files of the below the
 * source path are copied to the corresponding locations relative to the target
 * path, symbolic links to directories are copied but not traversed into.
 */
function copyTree(from, to) {
    var source = resolveFile(from);
    var target = resolveFile(to);
    if (source.isDirectory()) {
        makeTree(target);
        var files = source.list();
        for each (var file in files) {
            var s = join(source, file);
            var t = join(target, file);
            if (isLink(s)) {
                symbolicLink(readLink(s), t);
            } else {
                copyTree(s, t);
            }
        }
    } else {
        copy(source, target);
    }
}

/**
 * Create the directory specified by "path" including any missing parent
 * directories.
 */
function makeTree(path) {
    var file = resolveFile(path);
    if (!file.isDirectory() && !file.mkdirs()) {
        throw new Error("failed to make tree " + path);
    }
}

/**
 * Return an array with all directories below (and including) the given path,
 * as discovered by depth-first traversal. Entries are in lexically sorted
 * order within directories. Symbolic links to directories are not traversed
 * into.
 */
function listDirectoryTree(path) {
    path = path === '' ? '.' : String(path);
    var result = [''];
    list(path).forEach(function (child) {
        var childPath = join(path, child);
        if (isDirectory(childPath)) {
            if (!isLink(childPath)) {
                result.push.apply(result,
                        listDirectoryTree(childPath).map(function (p) join(child, p)));
            } else { // Don't follow symlinks.
                result.push(child);
            }
        }
    });
    return result;
}

/**
 * Return an array with all paths (files, directories, etc.) below (and
 * including) the given path, as discovered by depth-first traversal. Entries
 * are in lexically sorted order within directories. Symbolic links to
 * directories are returned but not traversed into.
 */
function listTree(path) {
    path = path === '' ? '.' : String(path);
    var result = [''];
    list(path).forEach(function (child) {
        var childPath = join(path, child);
        // Don't follow directory symlinks, but include them
        if (isDirectory(childPath) && !isLink(childPath)) {
            result.push.apply(result,
                    listTree(childPath).map(function (p) join(child, p)));
        } else {
            // Add file or symlinked directory.
            result.push(child);
        }
    });
    return result;
}

/**
 * Remove the element pointed to by the given path. If path points to a
 * directory, all members of the directory are removed recursively.
 */
function removeTree(path) {
    var file = resolveFile(path);
    // do not follow symlinks
    if (file.isDirectory() && !isLink(file.getPath())) {
        for each (var child in file.list()) {
            removeTree(join(file, child));
        }
    }
    if (!file['delete']()) {
        throw new Error("failed to remove " + path);
    }
}

/**
 * Check whether the given pathname is absolute.
 *
 * This is a non-standard extension, not part of CommonJS Filesystem/A.
 */
function isAbsolute(path) {
    return new File(path).isAbsolute();
}

/**
 * Check wheter the given pathname is relative (i.e. not absolute).
 *
 * This is a non-standard extension, not part of CommonJS Filesystem/A.
 */
function isRelative(path) {
    return !isAbsolute(path);
}

/**
 * Make the given path absolute by resolving it against the current working
 * directory.
 */
function absolute(path) {
    return resolve(workingDirectory(), path);
}

/**
 * Return the basename of the given path. That is the path with any leading
 * directory components removed. If specified, also remove a trailing
 * extension.
 */
function base(path, ext) {
    var name = arrays.peek(split(path));
    if (ext && name) {
        var diff = name.length - ext.length;
        if (diff > -1 && name.lastIndexOf(ext) == diff) {
            return name.substring(0, diff);
        }
    }
    return name;
}

/**
 * Return the dirname of the given path. That is the path with any trailing
 * non-directory component removed.
 */
function directory(path) {
    return new File(path).getParent() || '.';
}

/**
 * Return the extension of a given path. That is everything after the last dot
 * in the basename of the given path, including the last dot. Returns an empty
 * string if no valid extension exists.
 */
function extension(path) {
    var name = base(path);
    if (!name) {
        return '';
    }
    name = name.replace(/^\.+/, '');
    var index = name.lastIndexOf('.');
    return index > 0 ? name.substring(index) : '';
}

/**
 * Join a list of paths using the local file system's path separator.
 * The result is not normalized, so `join("..", "foo")` returns `"../foo"`.
 * @see http://wiki.commonjs.org/wiki/Filesystem/Join
 *
 */
function join() {
    // filter out empty strings to avoid join("", "foo") -> "/foo"
    var args = Array.filter(arguments, function(p) p != "")
    return args.join(SEPARATOR);
}

/**
 * Split a given path into an array of path components.
 */
function split(path) {
    if (!path) {
        return [];
    }
    return String(path).split(SEPARATOR_RE);
}

/**
 * Normalize a path by removing '.' and simplifying '..' components, wherever
 * possible.
 */
function normal(path) {
    return resolve(path);
}

// Adapted from Narwhal.
/**
 * Join a list of paths by starting at an empty location and iteratively
 * "walking" to each path given. Correctly takes into account both relative and
 * absolute paths.
 */
function resolve() {
    var root = '';
    var elements = [];
    var leaf = '';
    var path;
    for (var i = 0; i < arguments.length; i++) {
        path = String(arguments[i]);
        if (path.trim() == '') {
            continue;
        }
        var parts = path.split(SEPARATOR_RE);
        // Checking for absolute paths is not enough here as Windows has
        // something like quasi-absolute paths where a path starts with a
        // path separator instead of a drive character, e.g. \home\projects.
        if (isAbsolute(path) || SEPARATOR_RE.test(path[0])) {
            // path is absolute, throw away everyting we have so far.
            // We still need to explicitly make absolute for the quasi-absolute
            // Windows paths mentioned above.
            root = new File(parts.shift() + SEPARATOR).getAbsolutePath();
            elements = [];
        }
        leaf = parts.pop();
        if (leaf == '.' || leaf == '..') {
            parts.push(leaf);
            leaf = '';
        }
        for (var j = 0; j < parts.length; j++) {
            var part = parts[j];
            if (part == '..') {
                if (elements.length > 0 && arrays.peek(elements) != '..') {
                    elements.pop();
                } else if (!root) {
                    elements.push(part);
                }
            } else if (part != '' && part != '.') {
                elements.push(part);
            }
        }
    }
    path = elements.join(SEPARATOR);
    if (path.length > 0) {
        leaf = SEPARATOR + leaf;
    }
    return root + path + leaf;
}

// Adapted from narwhal.
/**
 * Establish the relative path that links source to target by strictly
 * traversing up ('..') to find a common ancestor of both paths. If the target
 * is omitted, returns the path to the source from the current working
 * directory.
 */
function relative(source, target) {
    if (!target) {
        target = source;
        source = workingDirectory();
    }
    source = absolute(source);
    target = absolute(target);
    source = source.split(SEPARATOR_RE);
    target = target.split(SEPARATOR_RE);
    source.pop();
    while (
        source.length &&
        target.length &&
        target[0] == source[0]) {
        source.shift();
        target.shift();
    }
    while (source.length) {
        source.shift();
        target.unshift("..");
    }
    return target.join(SEPARATOR);
}

function move(from, to) {
    var source = resolveFile(from);
    var target = resolveFile(to);
    if (!source.renameTo(target)) {
        throw new Error("failed to move file from " + from + " to " + to);
    }
}

function remove(path) {
    var file = resolveFile(path);
    if (!file['delete']()) {
        throw new Error("failed to remove file " + path);
    }
}

function exists(path) {
    var file = resolveFile(path);
    return file.exists();
}

function workingDirectory() {
    return java.lang.System.getProperty('user.dir') + SEPARATOR;
}

function changeWorkingDirectory(path) {
    path = new File(path).getCanonicalPath();
    java.lang.System.setProperty('user.dir', path);
}

function removeDirectory(path) {
    var file = resolveFile(path);
    if (!file['delete']()) {
        throw new Error("failed to remove directory " + path);
    }
}

function list(path) {
    var file = resolveFile(path);
    var list = file.list();
    if (list == null) {
        throw new Error("failed to list directory " + path);
    }
    var result = [];
    for (var i = 0; i < list.length; i++) {
        result[i] = list[i];
    }
    return result;
}

function size(path) {
    var file = resolveFile(path);
    return file.length();
}

function lastModified(path) {
    var file = resolveFile(path);
    return new Date(file.lastModified());
}

function makeDirectory(path, permissions) {
    permissions = permissions != null ?
            new Permissions(permissions) : Permissions["default"];
    var POSIX = getPOSIX();
    if (POSIX.mkdir(path, permissions.toNumber()) != 0) {
        throw new Error("failed to make directory " + path);
    }
}

function isReadable(path) {
    return resolveFile(path).canRead();
}

function isWritable(path) {
    return resolveFile(path).canWrite();
}

function isFile(path) {
    return resolveFile(path).isFile();
}

function isDirectory(path) {
    return resolveFile(path).isDirectory();
}

/**
 * Return true if target file is a symbolic link, false otherwise.
 * @param target
 */
function isLink(target) {
    try {
        var POSIX = getPOSIX();
        var stat = POSIX.lstat(target);
        return stat.isSymlink();
    } catch (error) {
        // fallback if POSIX is no available
        target = resolveFile(target);
        var parent = target.getParentFile();
        if (!parent) return false;
        parent = parent.getCanonicalFile();
        target = new File(parent, target.getName());
        return !target.equals(target.getCanonicalFile())
    }
}

function same(pathA, pathB) {
    var POSIX = getPOSIX();
    var stat1 = POSIX.stat(pathA);
    var stat2 = POSIX.stat(pathB);
    return stat1.isIdentical(stat2);
}

function sameFilesystem(pathA, pathB) {
    var POSIX = getPOSIX();
    var stat1 = POSIX.stat(pathA);
    var stat2 = POSIX.stat(pathB);
    return stat1.dev() == stat2.dev();
}

function canonical(path) {
    return resolveFile(path).getCanonicalPath();
}

function touch(path, mtime) {
    mtime = mtime || Date.now();
    return resolveFile(path).setLastModified(mtime);
}

function symbolicLink(source, target) {
    var POSIX = getPOSIX();
    return POSIX.symlink(source, target);
}

function hardLink(source, target) {
    var POSIX = getPOSIX();
    return POSIX.link(source, target);
}

function readLink(path) {
    var POSIX = getPOSIX();
    return POSIX.readlink(path);
}

function iterate(path) {
    var iter = function() {
        for each (var item in list(path)) {
            yield item;
        }
        throw StopIteration;
    }();
    // spec requires iterator(), native iterators/generators only have __iterator__().
    iter.iterator = iter.__iterator__;
    return iter;
}

function Permissions(permissions, constructor) {
    if (!(this instanceof Permissions)) {
        return new Permissions(permissions, constructor);
    }
    this.update(Permissions['default']);
    this.update(permissions);
    /** @ignore */
    this.constructor = constructor;
}

Permissions.prototype.update = function(permissions) {
    var fromNumber = typeof permissions == 'number';
    if (!fromNumber && !(permissions instanceof Object)) {
        return;
    }
    for each (var user in ['owner', 'group', 'other']) {
        this[user] = this[user] || {};
        for each (var perm in ['read', 'write', 'execute']) {
            this[user][perm] = fromNumber ?
                Boolean((permissions <<= 1) & 512) :
                Boolean(permissions[user] && permissions[user][perm]);
        }
    }
};

Permissions.prototype.toNumber = function() {
    var result = 0;
    for each (var user in ['owner', 'group', 'other']) {
        for each (var perm in ['read', 'write', 'execute']) {
            result <<= 1;
            result |= +this[user][perm];
        }
    }
    return result;
};

if (!Permissions['default']) {
    try {
        var POSIX = getPOSIX();
        // FIXME: no way to get umask without setting it?
        var umask = POSIX.umask(0022);
        if (umask != 0022) {
            POSIX.umask(umask);
        }
        Permissions['default'] = new Permissions(~umask & 0777);
    } catch (error) {
        Permissions['default'] = new Permissions(0755);
    }
}

function permissions(path) {
    var POSIX = getPOSIX();
    var stat = POSIX.stat(path);
    return new Permissions(stat.mode() & 0777);
}

function owner(path) {
    try {
        var POSIX = getPOSIX();
        var uid = POSIX.stat(path).uid();
        var owner = POSIX.getpwuid(uid);
        return owner ? owner.pw_name : uid;
    } catch (error) {
        return null;
    }
}

function group(path) {
    try {
        var POSIX = getPOSIX();
        var gid = POSIX.stat(path).gid();
        var group = POSIX.getgrgid(gid);
        return group ? group.gr_name : gid;
    } catch (error) {
        return null;
    }
}

function changePermissions(path, permissions) {
    permissions = new Permissions(permissions);
    var POSIX = getPOSIX();
    var stat = POSIX.stat(path);
    // do not overwrite set-UID bits etc
    var preservedBits = stat.mode() & 07000;
    var newBits = permissions.toNumber();
    POSIX.chmod(path, preservedBits | newBits);
}

// Supports user name string as well as uid int input.
function changeOwner(path, user) {
    var POSIX = getPOSIX();
    return POSIX.chown(path, typeof user === 'string' ?
            POSIX.getpwnam(user).pw_uid : user, -1);
}

// Supports group name string as well as gid int input.
function changeGroup(path, group) {
    var POSIX = getPOSIX();
    return POSIX.chown(path, -1, typeof group === 'string' ?
            POSIX.getgrnam(group).gr_gid : group);
}

var optionsMask = {
    read: 1,
    write: 1,
    append: 1,
    update: 1,
    binary: 1,
    exclusive: 1,
    canonical: 1,
    charset: 1
};

/**
 * Internal.
 */
function checkOptions(options) {
    if (!options) {
        options = {};
    } else if (typeof options != 'object') {
        if (typeof options == 'string') {
            // if options is a mode string convert it to options object
            options = applyMode(options);
        } else {
            throw new Error('unsupported options argument');
        }
    } else {
        // run sanity check on user-provided options object
        for (var key in options) {
            if (!(key in optionsMask)) {
                throw new Error("unsupported option: " + key);
            }
            options[key] = key == 'charset' ?
                    String(options[key]) : Boolean(options[key]);
        }
    }
    return options;
}

/**
 * Internal. Convert a mode string to an options object.
 */
function applyMode(mode) {
    var options = {};
    for (var i = 0; i < mode.length; i++) {
        switch (mode[i]) {
        case 'r':
            options.read = true;
            break;
        case 'w':
            options.write = true;
            break;
        case 'a':
            options.append = true;
            break;
        case '+':
            options.update = true;
            break;
        case 'b':
            options.binary = true;
            break;
        case 'x':
            options.exclusive = true;
            break;
        case 'c':
            options.canonical = true;
            break;
        default:
            throw new Error("unsupported mode argument: " + options);
        }
    }
    return options;
}

/**
 * Internal.
 */
function resolveFile(path) {
    // Fix for http://bugs.sun.com/bugdatabase/view_bug.do?bug_id=4117557
    // relative files are not resolved against workingDirectory/user.dir in java,
    // making the file absolute makes sure it is resolved correctly.
    if (path == undefined) {
        throw new Error('undefined path argument');
    }
    var file = path instanceof File ? path : new File(String(path));
    return file.isAbsolute() ? file : file.getAbsoluteFile();
}


// Path object

/**
 * A shorthand for creating a new `Path` without the `new` keyword.
 */
function path() {
    return new Path(join.apply(null, arguments));
}

/**
 * Path constructor. Path is a chainable shorthand for working with paths.
 * @augments String
 */
function Path() {
    if (!(this instanceof Path)) {
        return new Path(join.apply(null, arguments));
    }
    var path = join.apply(null, arguments)
    this.toString = function() path;
    return this;
}

/** @ignore */
Path.prototype = new String();

/**
 * This is a non-standard extension, not part of CommonJS Filesystem/A.
 */
Path.prototype.valueOf = function() {
    return this.toString();
};

/**
 * Join a list of paths to this path.
 */
Path.prototype.join = function() {
    return new Path(join.apply(null,
            [this.toString()].concat(Array.slice(arguments))));
};

/**
 * Resolve against this path.
 */
Path.prototype.resolve = function () {
    return new Path(resolve.apply(
            null,
            [this.toString()].concat(Array.slice(arguments))
        )
    );
};

/**
 * Return the relative path from this path to the given target path. Equivalent
 * to `fs.Path(fs.relative(this, target))`.
 */
Path.prototype.to = function (target) {
    return exports.Path(relative(this.toString(), target));
};

/**
 * Return the relative path from the given source path to this path. Equivalent
 * to `fs.Path(fs.relative(source, this))`.
 */
Path.prototype.from = function (target) {
    return exports.Path(relative(target, this.toString()));
};

/**
 * Return the names of all files in this path, in lexically sorted order and
 * wrapped in Path objects.
 */
Path.prototype.listPaths = function() {
    return this.list().map(function (file) new Path(this, file), this);
};

var pathed = [
    'absolute',
    'base',
    'canonical',
    'directory',
    'normal',
    'relative'
];

for (var i = 0; i < pathed.length; i++) {
    var name = pathed[i];
    Path.prototype[name] = (function (name) {
        return function () {
            return new Path(exports[name].apply(
                this,
                [this.toString()].concat(Array.slice(arguments))
            ));
        };
    })(name);
}

var trivia = [
    'copy',
    'copyTree',
    'exists',
    'extension',
    'isDirectory',
    'isFile',
    'isLink',
    'isReadable',
    'isWritable',
    'iterate',
    'iterateTree',
    'lastModified',
    'link',
    'list',
    'listDirectoryTree',
    'listTree',
    'makeDirectory',
    'makeTree',
    'move',
    'open',
    'read',
    'remove',
    'removeTree',
    'rename',
    'size',
    'split',
    'symbolicLink',
    'touch',
    'write'
];

for (i = 0; i < trivia.length; i++) {
    var name = trivia[i];
    Path.prototype[name] = (function (name) {
        return function () {
            var fn = exports[name];
            if (!fn) throw new Error("Not found: " + name);
            var result = exports[name].apply(
                this,
                [this.toString()].concat(Array.slice(arguments))
            );
            if (result === undefined)
                result = this;
            return result;
        };
    })(name);
}

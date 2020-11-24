import { BuilderConfiguration, BuildEvent } from '@angular-devkit/architect';
import {
  BrowserBuilder,
  NormalizedBrowserBuilderSchema
} from '@angular-devkit/build-angular';
import { Path, virtualFs } from '@angular-devkit/core';
import * as fs from 'fs';
import * as path from 'path';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import * as ZipPlugin from 'zip-webpack-plugin';
import { ConcatWebpackPlugin } from '../common/concat';
import { BasePluginBuilderSchema, ExtensionManifest } from '../common/interfaces';
import {
    extractExternalRegExps,
    filterRuntimeModules,
    nameVendorFile,
    processManifestJsonFile,
    VCD_CUSTOM_LIB_SEPARATOR
} from '../common/utilites';

export interface PluginBuilderSchema6X extends NormalizedBrowserBuilderSchema, BasePluginBuilderSchema {}

export const defaultExternals = {
    common: [
        /^@angular\/.+$/,
        /^@ngrx\/.+$/,
        /^@vcd\/common$/,
        /^@vcd-ui\/common$/,
        {
            reselect: 'reselect'
        }
    ],
    ['9.7-10.0']: [
        /^rxjs(\/.+)?$/,
        /^@clr\/.+$/,
        {
            'clarity-angular': 'clarity-angular',
        }
    ]
};

export default class PluginBuilder extends BrowserBuilder {
      private options: PluginBuilderSchema6X;

      private entryPointPath: string;
    private entryPointOriginalContent: string;
    private pluginLibsBundles = new Map<string, string>();

    constructor(context) {
        super(context);
    }

    patchEntryPoint(contents: string) {
        fs.writeFileSync(this.entryPointPath, contents);
    }

    buildWebpackConfig(
        root: Path,
        projectRoot: Path,
        host: virtualFs.Host<fs.Stats>,
        options: PluginBuilderSchema6X
    ) {
        if (!this.options.modulePath) {
            throw Error('Please define modulePath!');
        }

        const config = super.buildWebpackConfig(root, projectRoot, host, options);

        // Reset the default configurations
        delete config.entry.polyfills;
        delete config.optimization.runtimeChunk;
        delete config.optimization.splitChunks;
        delete config.entry.styles;
        delete config.entry['polyfills-es5'];

        // List the external libraries which will be provided by vcd
        config.externals = [
            ...(options.ignoreDefaultExternals ? [] : defaultExternals.common),
            ...(!options.enableRuntimeDependecyManagement && !options.ignoreDefaultExternals ? defaultExternals['9.7-10.0'] : []),
            ...extractExternalRegExps(options.externalLibs),
        ];

        const [modulePathWithExt, moduleName] = this.options.modulePath.split('#');

        if (options.enableRuntimeDependecyManagement) {
            const self = this;

            // Create unique jsonpFunction name
            const copyPlugin = config.plugins.find((x) => x && x.copyWebpackPluginPatterns);
            const manifestJsonPath = path.join(copyPlugin.copyWebpackPluginPatterns[0].context, 'manifest.json');
            const manifest: ExtensionManifest = JSON.parse(fs.readFileSync(manifestJsonPath, 'utf-8'));
            config.output.jsonpFunction = `vcdJsonp#${moduleName}#${manifest.urn}`;

            // Configure the vendor chunks
            config.optimization.splitChunks = {
                chunks: 'all',
                cacheGroups: {
                    vendor: {
                        test: filterRuntimeModules(options),
                        name: nameVendorFile(config, options, self.pluginLibsBundles),
                    },
                },
            };

            // Transform manifest json file.
            copyPlugin.copyWebpackPluginPatterns[0].transform = processManifestJsonFile(
                options.librariesConfig || {},
                this.pluginLibsBundles,
                config.output.jsonpFunction
            );
        }

        // preserve path to entry point
        // so that we can clear use it within `run` method to clear that file
        this.entryPointPath = config.entry.main[0];
        this.entryPointOriginalContent = fs.readFileSync(this.entryPointPath, 'utf-8');

        // Export the plugin module
        const modulePath = modulePathWithExt.substr(0, modulePathWithExt.indexOf('.ts'));
        const entryPointContents = `export * from '${modulePath}';`;
        this.patchEntryPoint(entryPointContents);

        // Define amd lib
        config.output.filename = `bundle.js`;
        config.output.library = moduleName;
        config.output.libraryTarget = 'amd';
        // workaround to support bundle on nodejs
        config.output.globalObject = `(typeof self !== 'undefined' ? self : this)`;

        // Reset angular compiler entry module, in order to compile our plugin.
        const ngCompilerPluginInstance = config.plugins.find(
            x => x.constructor && x.constructor.name === 'AngularCompilerPlugin'
        );

        if (ngCompilerPluginInstance) {
            ngCompilerPluginInstance._entryModule = modulePath;
        }

        if (options.enableRuntimeDependecyManagement) {
            config.plugins.push(
                new ConcatWebpackPlugin({
                    concat: [
                        {
                            inputs: [
                                'bundle.js',
                                'vendors~main.bundle.js'
                            ],
                            output: 'bundle.js'
                        }
                    ]
                })
            );
        }

        // Zip the result
        config.plugins.push(
            new ZipPlugin({
                filename: 'plugin.zip',
                exclude: [
                    /\.html$/,
                    ...Object.keys(options.librariesConfig)
                    .filter((key) => {
                        return options.librariesConfig[key].scope === 'external';
                    })
                    .map((key) => `${key.replace('/', VCD_CUSTOM_LIB_SEPARATOR)}@${options.librariesConfig[key].version}.bundle.js`)
                ]
            }),
        );

        return config;
    }

    run(
        builderConfig: BuilderConfiguration<PluginBuilderSchema6X>
    ): Observable<BuildEvent> {
        this.options = builderConfig.options;
        this.options.fileReplacements = this.options.fileReplacements && this.options.fileReplacements.length ?
            this.options.fileReplacements : [];
        this.options.styles = this.options.styles && this.options.styles.length ? this.options.styles : [];
        this.options.scripts = this.options.scripts && this.options.scripts.length ? this.options.scripts : [];

        // To avoid writing it in my scripts every time keep it here
        builderConfig.options.deleteOutputPath = false;

        return super.run(builderConfig).pipe(
            tap(() => {
                // clear entry point so our main.ts (or any other entry file) to remain untouched.
                this.patchEntryPoint(this.entryPointOriginalContent);
            })
        );
    }
}
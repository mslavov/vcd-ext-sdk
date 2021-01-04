import { } from 'jasmine';
import { AbstractPlugin } from './AbstractPlugin';
import { ComponentDeployer } from './ComponentDeployer';

class TestPlugin extends AbstractPlugin {
    name = 'test';
    module = './AbstractPlugin/TestPlugin';
    displayName = 'Test Plugin';

    getComponentDeployer(): ComponentDeployer {
        throw new Error('Method not implemented.');
    }
    getDefaultOutDir(): string {
        throw new Error('Method not implemented.');
    }
    getDefaultFiles(): string {
        throw new Error('Method not implemented.');
    }
    getSrcRoot(): string {
        return 'test/root';
    }
}

describe('AbstractPlugin Tests', () => {
    it('Generate plugin files', () => {
        const fs = jasmine.createSpyObj('fs', ['copyTpl', 'readJSON', 'writeJSON']);
        fs.readJSON.and.returnValue({
            elements: []
        });
        const generator = jasmine.createSpyObj('generator', ['sourceRoot', 'templatePath', 'destinationPath']);
        generator.fs = fs;
        const answers = {
            elements: {
                test: {
                    name: 'test'
                }
            }
        };
        new TestPlugin().generate(generator, answers);
        expect(generator.sourceRoot).toHaveBeenCalledWith('test/root');
        expect(generator.templatePath).toHaveBeenCalled();
        expect(generator.destinationPath).toHaveBeenCalled();
    });
    it('Generate generate plugin files, no name provided', () => {
        const fs = jasmine.createSpyObj('fs', ['copyTpl', 'readJSON', 'writeJSON']);
        fs.readJSON.and.returnValue({
            elements: []
        });
        const generator = jasmine.createSpyObj('generator', ['sourceRoot', 'templatePath', 'destinationPath']);
        generator.fs = fs;
        const answers = {
            elements: {
                test: {}
            }
        };
        new TestPlugin().generate(generator, answers);
        expect(generator.sourceRoot).toHaveBeenCalledWith('test/root');
        expect(generator.templatePath).toHaveBeenCalled();
        expect(generator.destinationPath).toHaveBeenCalled();
    });
});

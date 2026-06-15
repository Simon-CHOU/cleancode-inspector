export const ABSTRACT_TASK_ENGINE_FIXTURE = `package com.myschneider.myschneider.dec_happy.engine;

import com.myschneider.myschneider.dec_happy.dto.ProcessRequest;
import com.myschneider.myschneider.dec_happy.dto.ProcessResponse;
import com.myschneider.myschneider.dec_happy.entity.ProjectTask;
import com.myschneider.myschneider.dec_happy.service.ProjectTaskService;
import org.springframework.beans.factory.annotation.Autowired;

public abstract class AbstractTaskEngine implements TaskEngine {

    @Autowired
    protected ProjectTaskService projectTaskService;

    @Override
    public void start(ProcessRequest request, ProcessResponse response) {
        doHandler(request, response);
    }

    @Override
    public void complete(ProcessRequest request, ProcessResponse response) {
        beforeComplete(request, response);
        projectTaskService.completeTask(request.getTaskId());
        ProjectTask nextTask = createNextTaskInfo(request);
        projectTaskService.createNextTask(nextTask);
        afterCompleted(request, response, nextTask);
    }

    protected void doHandler(ProcessRequest request, ProcessResponse response) {
        // Default implementation
    }

    protected abstract void beforeComplete(ProcessRequest request, ProcessResponse response);

    protected abstract void afterCompleted(ProcessRequest request, ProcessResponse response, ProjectTask projectTask);

    protected abstract String getTaskAssignRoleCode(ProcessRequest request);

    private ProjectTask createNextTaskInfo(ProcessRequest request) {
        ProjectTask task = new ProjectTask();
        task.setProcessNodeCode(getTaskAssignRoleCode(request));
        task.setProcessUserId(request.getUserId());
        task.setStatus(0);
        return task;
    }
}`;

export const MINIMAL_JAVA_FIXTURE = `public class HelloWorld {
    public void sayHello() {
        System.out.println("hello");
    }
}`;

---
layout: post
title: Reskinning built in workflow activities
categories:
tags: [WF, .NET, C#]
description: How to change them ugly default workflow activity designers!
comments: true
---

## Background
Allowing your end users to design there own workflow within your system is great! But the built in activity designers are pretty ugly...

Obviously we did a fair bit of googling around trying to find out how we could re-skin the build in WF activities, but with not much luck the best solution we stumbled across was to create our own version of the each built in activity that we wanted to use. We personally didn't think this was ideal, but as a starter it was something to progress on to make our workflows nice and pretty!

To start with, we create our own activity of sequence and our own sequence activity designer. For the time being this was working as expected and the end users got some nicely designed sequence activity to play around with. In the back of our minds we knew it was a big code smell (duplicating built in functionality).

After a while we started to notice our custom activity wasn't working as expected. When we had long running activities or activities that created bookmarks they were not getting processed correctly. A bit of debugging resulted in noticing the activities weren't getting scheduled correctly. We thought to ourselfs if only we hadn't created our own activity for sequence and used the built in sequence activity that had been fully tested and used by workflow users already...

We can only assume that the above issue was going to bite us again as we were going to need to copy most of the inbuilt activities (Parallel, IfElse, While, etc..)
We then planned some time to investigate to see if there was a better way again.

## Hello ILSpy
To start off with we opened up ILSpy and started poking around inside the following assemblies:

* System.Activities
* System.Activities.Presentation
* System.Activities.Core.Presentation

Our set-up is very similar - splitting out our Activities from our Presentation of the Activities, so we knew what we'd find.

The first idea was just to inherit from the built in activity and just expose it as our own activity and then link it to our own presentation files.

```csharp
public sealed class Sequence : NativeActivity
{
    // Code...
}
```

```csharp
public class MyAwesomeSequence : Sequence
{
}
```

**The above will not compile**

All the built in activities are sealed so there's no way to inherit from them, so first idea straight out the window.

Next up was seeing how the activities plug to their coinciding presentation code. Inside of the workflow foundation there is an interface of `IRegisterMetadata` - this interface is scanned for by the designers (rehosted workflow designers are mostly likely instantiating these manually) and then the Register method is called. The idea of this is so that the activities and their designers are decoupled and only the meta data that is created within this `IRegisterMetaData` describes how they are linked.

[IRegisterMetaData (MSDN)](http://msdn.microsoft.com/en-us/library/microsoft.windows.design.metadata.iregistermetadata(v=vs.90).aspx)

Drilling down in to `DesignerMetadata` which implements `IRegisterMetaData` we'll find that `SequenceDesigner.RegisterMetadata(AttributeTableBuilder )` gets called with a builder. From here we can now see how it's linking up sequence activity or the sequence activity designer.
There is only really one bit of code in this whole block that we care about at the moment:

```csharp
Type typeFromHandle = typeof(Sequence);
builder.AddCustomAttributes(typeFromHandle, new Attribute[]
{
new DesignerAttribute(typeof(SequenceDesigner))
});
```

The code block above is assigning a custom attribute to the sequence activity type that says the designer is of type SequenceDesigner.
So we've nearly made it! All we have to do is swap out that bit of code to be something like the following:

```csharp
Type typeFromHandle = typeof(Sequence);
builder.AddCustomAttributes(typeFromHandle, new Attribute[]
{
new DesignerAttribute(typeof(MyAwesomeSequenceDesigner))
});
```

Oh but we can't just start mangling the `System.Activities.Core.Presentation` assembly...

## Implementing IRegisterMetaData
So going back to the `IRegisterMetaData` interface, we'll have to create our own RegisterMetaData:

```csharp
public class MyAwesomeDesignerMetadata : IRegisterMetadata
{
    public void Register()
    {
        // Create an attribute Builder.
        var builder = new AttributeTableBuilder();

        // Add our override custom attributes.
        var typeFromHandle = typeof (Sequence);
        builder.AddCustomAttributes(typeFromHandle, new Attribute[]
        {
            new DesignerAttribute(typeof (MyAwesomeSequenceDesigner))
        });

        // Store in the MetadataStore.
        MetadataStore.AddAttributeTable(builder.CreateTable());
    }
}
```
This will now load within the designer (Visual Studio) and load our new Sequence Designer!
If you are rehosting the workflow designer, you can just instantiate `MyAwesomeDesignerMetadata` and call `Register()` manually:

```csharp
private void RegisterMetadata()
{             
    // Built in DesignerMetaData.
    var dm1 = new DesignerMetadata();
    dm1.Register();

    // Our Custom DesignerMetaData.
    var dm2 = new MyAwesomeDesignerMetadata();
    dm2.Register();
}
```

## Wrapping it all up
Now we've gone though all the stages of what we need to create. We can wrap it all up and standardize a few bits:

```csharp
// MyAwesomeDesignerMetadata.cs
public class MyAwesomeDesignerMetadata : IRegisterMetadata
{
    public void Register()
    {
        // Create an attribute Builder.
        var builder = new AttributeTableBuilder();

        SequenceActivityDesigner.RegisterMetadata(builder);
        // More of our own Designers...

        // Store in the MetadataStore.
        MetadataStore.AddAttributeTable(builder.CreateTable());
    }
}
```

```csharp
// SequenceActivityDesigner.cs
public partial class SequenceActivityDesigner
{
    public SequenceActivityDesigner()
    {
        this.InitializeComponent();
    }

    public override void OnApplyTemplate()
    {
        var titleImage = GetTemplateChild("TitleImage") as Image;

        if (titleImage != null)
        {
            titleImage.Source = new BitmapImage(new Uri("pack://application:,,,/Kevsoft.Activities.Design;component/Images/sequence.png"));
        }

        base.OnApplyTemplate();
    }

    public static void RegisterMetadata(AttributeTableBuilder builder)
    {
        builder.AddCustomAttributes(typeof(Sequence), new DesignerAttribute(typeof(SequenceActivityDesigner)));
    }
}
```

```xml
<!-- SequenceActivityDesigner.xaml -->
<sap:WorkflowViewElement x:Class="Kevsoft.Activities.Design.SequenceActivityDesigner"
    xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
    xmlns:sap="clr-namespace:System.Activities.Presentation;assembly=System.Activities.Presentation"
    HorizontalAlignment="Center"
    Template="{StaticResource WorkflowElement}">
    
    <Grid>
        <StackPanel HorizontalAlignment="Center" VerticalAlignment="Center">

            <Ellipse Fill="LightGreen" Height="20" Width="20" StrokeThickness="1" Stroke="#FFA8B3C2"/>

            <sap:WorkflowItemsPresenter HintText="Drop Activities Here" Items="{Binding Path=ModelItem.Activities}">
                <sap:WorkflowItemsPresenter.SpacerTemplate>
                    <DataTemplate>
                        <Path Margin="0" Stretch="Fill" StrokeThickness="1.5" StrokeMiterLimit="2.75" Stroke="#FFA8B3C2" Fill="#FFA8B3C2" Data="F1 M 0,2l 0,19l 1,0l -1,10l -1,-10l 1,0 Z" Width="8" Height="30"/>
                    </DataTemplate>
                </sap:WorkflowItemsPresenter.SpacerTemplate>

                <sap:WorkflowItemsPresenter.ItemsPanel>
                    <ItemsPanelTemplate>
                        <StackPanel Orientation="Vertical"/>
                    </ItemsPanelTemplate>
                </sap:WorkflowItemsPresenter.ItemsPanel>
            </sap:WorkflowItemsPresenter>

        </StackPanel>
    </Grid>
</sap:WorkflowViewElement>
```